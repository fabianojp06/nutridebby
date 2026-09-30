# Plano 03 — Pacientes & prontuário (M2): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o M2 sobre a Plataforma: a nutricionista cadastra paciente adulto e o convida por e-mail (7 dias), o paciente cria a senha e aceita o termo, e o prontuário ganha etiquetas, anamnese com modelo editável e snapshot, antropometria e gasto energético com as fórmulas do Apêndice A, exames com laudo e valores, atendimentos com notas privadas, evolução em gráficos e LGPD (arquivar, exportar ZIP, bloquear por pedido de exclusão e anonimizar no fim do prazo) — tudo com RLS por tenant e por paciente, auditoria e teste de isolamento.

**Architecture:** Módulo novo `src/modules/pacientes` (um arquivo por assunto), chamado pelas páginas de `src/app/painel/pacientes/**` e por dois Route Handlers (JSON do paciente e upload de exame). Toda tabela nova tem `tenant_id` + RLS forçada + política por paciente + gatilho de auditoria; as tabelas filhas apontam para o paciente por **FK composta** `(tenant_id, patient_id) → patients (tenant_id, id)`, então nem um bug de serviço consegue ligar um registro ao paciente de outro tenant. Notas privadas e etiquetas ficam em tabelas com uma terceira política, `staff_only`, que esconde tudo da sessão de paciente **no banco** (US-016/US-019 "nem no JSON da API"). Fórmulas são funções puras (usadas no servidor e, para a prévia ao vivo, no navegador). Gráficos são SVG renderizado no servidor, sem biblioteca. Exportação e anonimização rodam no worker (pg-boss); o ZIP (`dados.json` + `prontuario.pdf`) é guardado em `/data` como qualquer arquivo (cota, URL assinada de 5 min) e some em 24 h.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Server Actions, `PageProps`/`LayoutProps`) · React 19.2 (`cache`, `useActionState`) · PostgreSQL 16 (`citext`, `unaccent`, colunas geradas, FK composta) · Drizzle 0.45 (`numeric` em `mode: 'number'`) · Better Auth 1.7.6 · pg-boss 12.34 · Zod 4 · `@react-pdf/renderer` 4.9 (novo, só no worker) · `fflate` 0.8 (novo, só no worker) · Vitest 5 + Testcontainers · Playwright 1.63 + Mailpit.

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.4) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md) (US-010 a US-019, Apêndice A). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P03-01 a P03-11).

## Global Constraints

- Tudo dos Planos 01 e 02 continua valendo: Node 24, TypeScript `strict`, pnpm com `--frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` na entrada de toda página e Server Action da nutricionista; `requireApiNutri` em todo Route Handler dela.
- RNF-07 / §4.1 / CLAUDE.md regras 1, 2 e 8: toda tabela nova com `tenant_id` passa por `withTenant` e ganha migration custom com `app_enable_tenant_rls`, `app_enable_patient_rls` (se tiver `patient_id`) e `app_enable_audit`; `patients` usa `app_enable_patient_rls('patients', 'id')` e `app_enable_audit('patients', 'patients', 'id')`. Toda tabela nova com `tenant_id` entra em `FABRICAS` de `test/isolamento.test.ts`. O admin nunca consulta essas tabelas (guarda `sem-tabelas-tenant`).
- Migrations rodam com `DATABASE_URL_MIGRATOR` (em produção, `nutri_owner` sem superusuário). Nada aqui exige superusuário. Números de migration indicados são os esperados executando as tarefas em ordem; o que vale é o **nome**.
- RNF-08 / US-007: leitura de dado de saúde → `auditRead(tx, …)` na mesma transação; escrita → gatilho. Ações especiais (`exportar`, `bloquear`, `anonimizar`) → `recordAudit`. "Histórico de acessos" = aba do prontuário, 50 por página, ordem decrescente.
- US-010 (texto exato): "Informe o nome" (2–120); "O sistema atende apenas pacientes a partir de 18 anos"; "Selecione o sexo biológico (usado nas fórmulas)"; "Paciente já cadastrado com este e-mail"; "Telefone inválido"; rótulo "Paciente autorizou receber mensagens por WhatsApp"; paciente criado "com status 'ativo' e user_id nulo"; "um e-mail de convite com link válido por 7 dias"; convite de quem já tem conta: "Entre com sua conta existente para ver os dados da nutricionista <A>".
- US-011: senha + termo versionado ("Li e aceito o Termo de Uso e Privacidade (versão …)"); botão **"Continuar"** desabilitado sem o termo; "Quero receber lembretes por WhatsApp" → `whatsapp_optin_origem = 'paciente'`; se a nutricionista já autorizou, vem marcado e desmarcar grava `whatsapp_optout_em`.
- RN-17 / D-11: idade ≥ 18 **na data do cadastro, no fuso do tenant** (RN-06).
- US-012: 7 tipos de pergunta (texto curto, texto longo, número com unidade, sim/não, escolha única, múltipla escolha, data); modelo padrão "Anamnese geral" com as seções da spec; `template_snapshot`; obrigatória vazia → "Responda: <pergunta>" e nada é salvo.
- US-013: circunferências braço, cintura, abdome, quadril, coxa, panturrilha (cm, 1 casa); dobras em mm (1 casa); IMC 70 kg/175 cm → **22,86**; JP3 M 30 anos S=50 → D **1,06432**, %G **15,08**; JP3 F 35 anos S=60 → %G **24,44**; dobra faltando → "Preencha as 7 dobras para calcular o % de gordura" e o resto salva; "Peso deve estar entre 1 e 400 kg".
- US-014 / RN-14: TMB e GET em kcal inteiros, arredondamento meio para cima; idade = anos completos na data do cálculo; Mifflin F 60/165/35 × 1,55 → TMB **1295**, GET **2008**; FAO/OMS F 60 kg 35 anos → **1351**; "Fator de atividade deve estar entre 1,00 e 2,50". Tolerância dos casos do Apêndice A: ±0,01.
- US-015: laudo PDF/JPEG/PNG até 20 MB, servido só por URL assinada de 5 min; erro "Envie PDF, JPEG ou PNG de até 20 MB"; valores com gráfico por marcador em ordem cronológica.
- US-016: `notas_privadas` nunca chegam ao paciente, "nem no JSON da API"; `orientacoes_paciente` sim.
- US-017: gráficos de peso, IMC, %G e circunferências; diferença primeiro × último ("−3,2 kg"); com 1 registro: "Registre mais uma avaliação para ver a evolução".
- US-018 / RNF-08: arquivar (selo "Arquivado"); exportar = ZIP com `dados.json` + `prontuario.pdf`, link por e-mail válido por 24 h, `audit_log` "exportar"; exclusão durante a guarda = `bloqueado`, opt-ins apagados na hora, prontuário mantido identificado, `anonimizar_apos` = última consulta + prazo legal (P-01), e-mail ao paciente, `privacy_requests` "concluido"; job diário anonimiza nome, e-mail, telefone e data de nascimento e apaga os anexos de `/data`.
- US-019: filtro por etiqueta devolve exatamente os pacientes etiquetados; paciente nunca vê etiqueta, nem no JSON.
- RNF-11 / CLAUDE.md regra 3: nada de dado de saúde, nome de paciente, nota, resposta de anamnese, medida ou valor de exame em log, erro ou e-mail de alerta. E-mails de sistema para a nutricionista não citam o paciente.
- RNF-12: datas `dd/mm/aaaa`, números com vírgula decimal, telefone exibido `(11) 91234-5678` e guardado em E.164.
- Arquivos (CLAUDE.md regra 9): gravar/apagar só por `salvarArquivo`/`apagarArquivo`; servir só por `signFileUrl`; caminho nunca montado com texto do usuário.
- Textos de interface em pt-BR, exatos quando a spec der; formulários acessíveis (`<label for>`, `aria-invalid`, `aria-describedby`, erro em `role="alert"`, sucesso em `role="status"`).
- Custo zero. Dependências novas (exatamente estas): `@react-pdf/renderer` e `fflate` (Tarefa 14), com `--save-exact` na versão mais nova que o *minimum-release-age* do pnpm aceitar. A imagem continua **≤ 260 MB comprimida** (orçamento do CI; hoje em 230 MB). Se estourar, **parar e avisar o dono** — nunca subir o limite.
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em banco de produção, serviços ou Easypanel neste plano; nunca exibir segredos.
- Política de revisão por entrega (índice): revisor por tarefa → `/code-review high` → correções → `/code-review high` (limpo) → `/security-review` com checklist reforçado; merge só com OK explícito do dono. Lembrar o dono de que o **P01-13 (Easypanel + primeiro deploy) segue pendente** antes de qualquer conversa de merge.

### Decisões de desenho (tomadas neste plano)

| Tema | Decisão | Custo / consequência |
|---|---|---|
| **Vínculo das tabelas filhas** | FK composta `(tenant_id, patient_id) → patients (tenant_id, id)` (UNIQUE `patients_tenant_id_unique`) em toda tabela com `patient_id`, `NO ACTION` (paciente nunca é apagado: arquiva, bloqueia, anonimiza). Notas → atendimento pela tripla `(tenant_id, patient_id, consultation_id)`. | O banco recusa um registro do tenant A apontando para paciente do tenant B, e uma nota apontando para atendimento de outro paciente. A matriz de isolamento passa a semear `patients` primeiro e apagar por último (Tarefa 1). |
| **Notas privadas e etiquetas** | Tabelas próprias (`consultation_notes`, `patient_tags`, `patient_tag_links`) com a política RESTRICTIVE `staff_only` (`app.role <> 'paciente'`), instalada por `app_enable_staff_only`; guarda `findStaffOnlyViolations` no CI. | Coluna em `consultations` não teria como ser escondida de uma sessão de paciente: o role do banco é o mesmo, e GRANT por coluna não distingue `app.role`. |
| **Convite do paciente** | Mesma tabela `invites` do Plano 02, com `tipo = 'paciente'`, `tenant_id`, `patient_id` e `user_id` nulo; só o SHA-256 do token; 7 dias; um pendente por paciente. `invites` entra nas exceções de RLS e de auditoria (lida pelo token antes de existir sessão). Rota própria `/convite/paciente/<token>`. | O paciente sem conta cria a senha no aceite (conta `paciente` sem `tenant_id`); quem já é paciente de outro tenant entra com a conta existente e só confirma o termo. |
| **Modelo padrão de anamnese** | Criado na primeira vez que o tenant lista os modelos (`garantirModeloPadrao`, índice único parcial `padrao`), não na criação da conta. | A criação da conta é do admin, que nunca toca tabela 🔒. "Excluir" modelo = arquivar; o padrão arquivado não volta. |
| **Gráficos** | Componente SVG próprio renderizado no servidor (`GraficoLinha`), com dica nativa por ponto e tabela de dados. | Sem o Recharts (§9.1): zero JS de gráfico no navegador, zero bytes na imagem, acessível por tabela. |
| **PDF e ZIP da exportação** | `@react-pdf/renderer` (fonte Helvetica padrão, cobre acentos; `paraWinAnsi` troca "≥", "≤", "−" e o que sair do WinAnsi) e `fflate` (`zipSync`), **só no worker** (`exportacao-job.ts`, fora do grafo do Next). ZIP guardado como `stored_files.tipo = 'exportacao'`; `detectarTipo`, `CAMINHO_ARQUIVO` e `/api/arquivos` passam a aceitar `.zip` (servido como anexo). | O P04-09 reaproveita o `@react-pdf/renderer`. A exportação ocupa cota até expirar (24 h). |
| **Link de 24 h da exportação** | O e-mail aponta para `/painel/pacientes/<id>/exportacoes/<exportId>` (exige login); a página emite a URL assinada de 5 min enquanto `expira_em` não passou. Um job agendado para +24 h apaga o arquivo; a varredura diária `retencao-lgpd` apaga o que esse job não conseguiu. ZIP e pedido nascem na mesma transação (`registrar` de `salvarArquivo`). | Continua valendo "servir só por `signFileUrl`" (CLAUDE.md regra 9). |
| **Conteúdo da exportação** | `dados.json` e `prontuario.pdf` com todas as tabelas do paciente **exceto** as `staff_only` (notas privadas e etiquetas). | A exportação é entregue ao titular; US-016/US-019 proíbem que ele veja notas e etiquetas. |
| **Paciente bloqueado** | Cadastro e prontuário viram só leitura (`carregarPacienteParaEscrita` recusa); convite recusado. Arquivado continua editável. | "Prontuário mantido … só para consulta da nutricionista" (US-018). |
| **Prazo de guarda** | Constante `PRAZO_GUARDA_ANOS = 20` (referência da spec; P-01 pendente com CRN/advogado) contada da última data de atendimento (ou do bloqueio, se não houver). | Mudar o prazo = trocar a constante (e recalcular `anonimizar_apos` de quem já está bloqueado, se o advogado mandar). |
| **Arquivo e registro juntos** | `salvarArquivo` ganha `registrar(tx, arquivo)` e `apagarArquivo` ganha `naMesmaTransacao(tx)` e `removerAntesDoCommit` (Tarefa 11). Exame e laudo, pedido de exportação e ZIP nascem e morrem na mesma transação. | Uma queda entre duas transações deixaria `stored_files` sem dono: cota ocupada para sempre e anexo fora do alcance da anonimização. |
| **Prova do aceite por vínculo** | `consents.tenant_id` (nulo no DPA) com UNIQUE `(user_id, termo_versao, tenant_id) NULLS NOT DISTINCT`; `consents` entra em `RLS_EXCEPTIONS` (Tarefa 3). | O paciente com duas nutricionistas aceita o termo uma vez para cada controladora, com data e IP de cada aceite. |
| **Anonimização** | Job diário `retencao-lgpd` às 04h (America/Sao_Paulo), varrendo `tenants` (inclusive suspensos): apaga os anexos (exames e exportações) e depois grava nome "Paciente anonimizado", e-mail `anonimo-<id>@anonimizado.invalid`, telefone e nascimento nulos, `user_id` nulo, `anonimizado_em`; `recordAudit('anonimizar')`. Idempotente. | O CHECK de nascimento/sexo passa a aceitar paciente anonimizado. |

### Decisões do dono na revisão do plano (2026-09-30)

Decidido pelo dono seguindo a recomendação, depois da revisão do plano por 5 revisores (antes da execução):

| Tema | Decisão | Onde |
|---|---|---|
| ZIP de exportação no backup | Excluído do `rclone sync` de `/data` (`--exclude '/*/exportacao/**'`): o ZIP é refeito a partir do banco e não pode sobreviver 30 dias no histórico do R2, contra o "some em 24 h" | Tarefa 14, Step 9b (o dono instala o script novo na P02-11) |
| Conta de login do titular anonimizado | A anonimização deste plano só solta `patients.user_id`; nome e e-mail da linha `user` do Better Auth ficam até o **P06-08** anonimizar a conta que não tiver outro vínculo (desvio consciente, registrado no backlog) | Tarefa 13; backlog P06-08 |
| Laudos na exportação (US-018) | Os arquivos dos laudos vão no ZIP, em `laudos/<data>-<posição>.<ext>` (nome sem texto do usuário), ligados ao exame pelo campo `laudo` do `dados.json` e citados no PDF. Teto de 200 MB de laudos por exportação (o ZIP é montado em memória no worker): acima disso, ou se o arquivo sumiu do disco, o laudo fica de fora com aviso (`laudosForaDoZip`) em vez de a exportação falhar. Decisão do dono em 2026-09-30, depois da revisão da Tarefa 14 | Tarefa 14 |
| Nomes do modelo padrão de anamnese | Texto exato da spec (US-012): "Medicamentos", "Alergias/intolerâncias", "Álcool/tabaco", "Preferências e aversões" | Tarefa 9 |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano — v1.5)

| Spec | Neste plano | Motivo |
|---|---|---|
| §9.7 (v1.4): "o convite de paciente (7 dias) fica para o Plano 06" | Convite por e-mail (P03-01) e aceite (P03-02) entram **aqui**, como no backlog e no índice. Ficam para o Plano 06: escolha da nutricionista no login com vários vínculos, tutorial de instalação, "Perfil > Notificações" (revogar WhatsApp depois do aceite), novo aceite quando o termo mudar de versão, e o bloqueio de portal/notificação por vínculo arquivado/bloqueado (RN-08) | O Plano 03 precisa entregar "cadastra e convida paciente" (índice); o que depende do portal nasce com o portal |
| US-010 "Enviar convite por WhatsApp" | Campo e envio entram no **P05-11** (WhatsApp Cloud API). Aqui só a autorização ("Paciente autorizou…", `whatsapp_optin_origem = 'nutri'`) | Não existe envio de WhatsApp antes do Plano 05 |
| US-011 termo "versão 1.0" | Texto **provisório** `TERMO_PACIENTE_VERSAO = '0.1-provisorio'` (mesma solução do DPA); o P08-06 publica o texto do advogado com versão nova | Texto jurídico pendente (P-02, E-09) |
| §7 `consultations.notas_privadas` | Tabela `consultation_notes` 🔒 com `staff_only` | Ver "Decisões de desenho" |
| §7 `consultations.appointment_id` e US-016 "Iniciar atendimento" a partir da agenda | Coluna e botão entram no **Plano 05** (a tabela `appointments` nasce lá). Aqui: "Novo atendimento" no prontuário, com atalhos para anamnese, antropometria e gasto energético | Não existe agenda antes do Plano 05 |
| US-014 "Usar como meta do plano" | Entra no **P04-05** (editor de plano). Aqui o cálculo é salvo em `energy_calcs` | `meal_plans` nasce no Plano 04 |
| US-014 / Apêndice A: Harris-Benedict F 60/165/35 = "1370,5 kcal (exibido como 1371)" | A própria fórmula da spec dá **1370,47** → exibido **1370** (meio para cima, RN-14). Os testes seguem a conta; a divergência vai para a Debby validar (P-08) | 655,1 + 9,563·60 + 1,850·165 − 4,676·35 = 1370,47; 1371 só sairia arredondando duas vezes |
| §9.1 Recharts | Gráfico SVG próprio no servidor | Ver "Decisões de desenho" |
| §7 `exams.arquivo_path` livre | `exams.arquivo_path` com FK para `stored_files.caminho` (`ON DELETE SET NULL`) | Apagar o arquivo pela API de armazenamento limpa o vínculo sozinho |
| §7 `data_exports` (não existia) | Tabela nova 🔒 `data_exports` (status, arquivo, `expira_em`, quem pediu) | Estado do job e do link de 24 h |
| §7 `anamnesis_templates` | Colunas `padrao` e `arquivado_em` a mais | Modelo padrão único por tenant; "excluir" sem perder o vínculo das anamneses já preenchidas |
| US-018 "fotos do diário … e inscrições de push … apagados na hora" | Aqui apaga os opt-ins e os convites pendentes; fotos do diário (Plano 06) e inscrições de push (Plano 05) entram em `atenderPedidoExclusao` quando essas tabelas existirem | As tabelas ainda não existem |
| US-018 "P não consegue mais entrar no portal deste tenant … sai das audiências" | Aqui: status `arquivado`/`bloqueado` gravado e respeitado no convite. Portal (Plano 06), notificações (P05-06) e audiências (P07-01) leem esse status | Portal, lembretes e conteúdos ainda não existem |
| §3 métricas "nº de pacientes" | `admin_tenant_metrics()` passa a contar `pacientes_ativos` (status `ativo`) | Consultas e mensagens continuam `NULL` até o Plano 05 |
| §7 `consents` sem tenant | `consents.tenant_id` nulo no DPA, preenchido no termo do paciente | Prova do aceite por nutricionista (ver "Decisões de desenho") |
| US-015 laudo "servido só por URL assinada" (abrir no navegador) | PDF servido como **download** (`content-disposition: attachment`), link "Baixar laudo" | O visualizador de PDF do Chrome não abre documento com a CSP `sandbox` de `/api/arquivos`; afrouxar a CSP abriria o PDF com a origem do app |
| US-018 "anonimiza nome, e-mail…" | A linha `user` do Better Auth do titular fica identificada até o P06-08 | Decisão do dono (acima) |
| Textos novos de interface | "Informe uma data de nascimento válida"; "Informe o telefone para registrar a autorização de WhatsApp"; "O paciente já ativou o acesso; o e-mail não pode ser alterado."; "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."; convite: "Convite expirado. Peça um novo à sua nutricionista.", "Convite inválido ou já usado. Se você já criou sua senha, entre com seu e-mail e senha.", "Este convite foi enviado para outro e-mail. Saia desta conta e abra o link de novo.", "Este e-mail já é usado por outra conta. Peça à sua nutricionista para cadastrar outro e-mail.", "O paciente já ativou o acesso ao portal.", "Paciente arquivado ou bloqueado não recebe convite.", "Para continuar, aceite o Termo de Uso e Privacidade."; antropometria: "Informe a data da avaliação", "Altura deve estar entre 30 e 250 cm", "Circunferência deve estar entre 5 e 300 cm", "Dobra deve estar entre 1 e 100 mm", "A data não pode ser no futuro", "Complete a data de nascimento e o sexo do paciente no cadastro.", "Preencha as 3 dobras…" (mesma frase da spec para o JP 3); gasto energético: "Escolha a fórmula"; anamnese: "Informe o nome do modelo", "Inclua pelo menos uma pergunta", "Use no máximo 100 perguntas", "Use no máximo 30 opções, com até 100 caracteres cada", "O modelo mudou enquanto você preenchia. Recarregue a página.", "Escolha o tipo da pergunta", "Informe o texto da pergunta", "Informe pelo menos 2 opções", "Resposta inválida: <pergunta>", "Modelo de anamnese não encontrado.", "Anamnese não encontrada."; etiquetas: "Use de 1 a 40 caracteres na etiqueta"; atendimentos: "Informe a data do atendimento", "Use no máximo 20000 caracteres nas notas privadas", "Use no máximo 5000 caracteres nas orientações", "Atendimento não encontrado."; exames: "Baixar laudo", "Tente novamente em alguns instantes." (dois envios de laudo ao mesmo tempo, mesmo texto do logo), "Informe o título do exame", "Informe a data do exame", "Confira os valores: informe nome e valor numérico", "Não foi possível salvar o exame. Tente de novo."; evolução: "Nenhum valor de exame lançado."; LGPD: "Digite o nome do paciente exatamente como está no cadastro para confirmar."; exportação: estados da página de download ("…ainda está sendo gerada…", "Este link expirou…", "Não foi possível gerar…", "Exportação não encontrada."); e-mails `convite_paciente`, `exclusao_atendida`, `exportacao_pronta` | A spec não define essas mensagens. Textos novos da revisão ("Baixar laudo", "O modelo mudou enquanto você preenchia. Recarregue a página.", limites da anamnese) aprovados pelo dono em 2026-09-30 |

### Itens adiados do Plano 02

**Incorporados** (a tarefa que resolve está entre parênteses):
- Guarda `sem-tabelas-tenant` com lista de tabelas escrita à mão e que pulava `.test.tsx` → deriva do schema (toda tabela com `tenantId` fora de `RLS_EXCEPTIONS`) (Tarefa 1).
- `admin_tenant_metrics()` com `pacientes_ativos` nulo → conta de verdade (Tarefa 1).
- Aba "Histórico de acessos" montada no prontuário (Tarefa 2).
- `ConfirmarBotao` só no admin → vai para `src/components` com nome acessível próprio (Tarefa 7).

**Não incorporados** (motivo):
- `actorUserId` opcional para `nutri`/`paciente` em `withTenant` — torná-lo obrigatório quebraria dezenas de testes de infraestrutura; todo serviço deste plano recebe o `ctx` de `requireNutri` (com ator e IP) e os testes conferem o ator nas linhas de auditoria. Revisão geral no P08-05.
- Arquivos `.tmp` órfãos após queda — limpeza no worker quando houver mais uploads (Plano 04, como já anotado).
- `recordAudit` em sessão de paciente — Plano 06 (as escritas do aceite do convite já saem com o ator = paciente).

## Review Focus

1. **Cadastro perto da meia-noite e aniversário de 18 anos** (nutricionista em São Paulo às 23h30 de 09/03, quando em UTC já é 10/03; paciente nascido em 10/03/2008) — a idade é calculada no fuso do tenant: nesse momento ainda tem 17 anos e o cadastro é recusado; no dia seguinte, aceito. Teste na Tarefa 1.
2. **Números digitados do jeito brasileiro** (`70,5`, `70.5`, ` 70 `, `1,55`, `7O`, `70,5 kg`) — vírgula e ponto valem, espaço é ignorado, lixo vira a mensagem do campo (nunca `NaN` gravado nem 500). Testes nas Tarefas 6 e 7.
3. **Convite aberto na conta errada** (paciente logado com outro e-mail; e-mail do paciente que é de uma nutricionista; duplo clique em "Continuar") — mensagem clara, nada vinculado, uma única conta e um único vínculo. Testes na Tarefa 4.
4. **Id de outro tenant ou malformado na URL** (`/painel/pacientes/<id de B>`, `/api/painel/pacientes/abc`, antropometria gravada com `patientId` de B) — 404 e nenhuma escrita, garantido também pela FK composta. Testes nas Tarefas 1 e 7.
5. **Mesmo e-mail cadastrado duas vezes ao mesmo tempo** (duas abas, duplo clique em "Cadastrar paciente", `ANA@Ex.com` × `ana@ex.com`) — um só paciente e um só convite; o outro recebe "Paciente já cadastrado com este e-mail". Testes nas Tarefas 1 e 3.

---

## Estrutura de arquivos

```
.
├── CLAUDE.md                                   # T1, T3, T5, T11, T14 (exceções da regra 1, staff_only, FABRICAS, arquivo+registro)
├── scripts/backup/nutri-backup.sh              # T14 — ZIPs de exportação fora do sync (dono reinstala na P02-11)
├── drizzle/                                    # 0016–0034 (T1, T3, T5, T7–T11, T13, T14)
├── e2e/pacientes.spec.ts                       # T2, T4, T7, T9, T13
├── test/
│   ├── pacientes.ts                            # T1 — novoTenant, novoPaciente, emailsNaFila, ctxPaciente
│   └── isolamento.test.ts                      # T1 (pacientes por tenant, ordem, staff_only) e cada tabela nova
└── src/
    ├── components/confirmar-botao.tsx          # T7 (movido do admin)
    ├── db/
    │   ├── rls-guard.ts · rls-guard.test.ts    # T1 (patients pela coluna id), T3 (invites, consents), T5 (STAFF_ONLY)
    │   ├── audit-guard.ts                      # T3 (invites)
    │   └── schema/{pacientes.ts,access.ts,index.ts}   # T1, T3, T5, T7–T11, T13, T14
    ├── email/{types.ts,templates.tsx,render.test.ts}  # T3, T13, T14
    ├── jobs/queues.ts                          # T13, T14
    ├── lib/
    │   ├── numero.ts                           # T6 — lerDecimal, formatarDecimal, arredondar, zod decimal
    │   ├── file-type.ts · signed-url.ts        # T14 (zip)
    ├── modules/plataforma/
    │   ├── audit.ts                            # rótulos de entidade (T1, T5, T7–T11, T13, T14)
    │   ├── armazenamento.ts                    # T11 — registrar / naMesmaTransacao / removerAntesDoCommit
    │   ├── convites.ts                         # T3 (só tipo 'nutri')
    │   └── tenant-status.ts                    # T13 — listarTenantIds
    ├── modules/pacientes/
    │   ├── base.ts                             # T1 — erros, idValido, carregarPacienteParaEscrita
    │   ├── datas.ts · telefone.ts              # T1
    │   ├── pacientes.ts                        # T1 (T3 convite, T5 filtro por etiqueta)
    │   ├── convite-paciente.ts · termo-paciente.ts   # T3, T4
    │   ├── etiquetas.ts                        # T5
    │   ├── formulas.ts                         # T6 (puro)
    │   ├── antropometria.ts · antropometria-constantes.ts   # T7
    │   ├── gasto-energetico.ts                 # T8
    │   ├── anamnese.ts · anamnese-padrao.ts    # T9
    │   ├── atendimentos.ts                     # T10
    │   ├── exames.ts · exames-constantes.ts    # T11
    │   ├── evolucao.ts · ui/grafico-linha.tsx  # T12
    │   ├── lgpd.ts                             # T13
    │   ├── exportacao.ts                       # T14 (app)
    │   └── exportacao-job.ts · prontuario-pdf.tsx   # T14 (só worker)
    ├── worker/index.ts                         # T13, T14
    └── app/
        ├── admin/sem-tabelas-tenant.test.ts    # T1
        ├── api/arquivos/route.ts               # T14 (zip)
        ├── api/painel/pacientes/[id]/route.ts  # T1 — JSON do paciente (404 fora do tenant)
        ├── api/painel/pacientes/[id]/exames/route.ts   # T11 — upload
        ├── convite/paciente/[token]/{page,form,actions}.tsx   # T4
        └── painel/
            ├── cabecalho.tsx                   # T2, T9
            ├── anamnese/modelos/**             # T9
            └── pacientes/
                ├── page.tsx · novo/page.tsx · actions.ts · paciente-form.tsx · valores.ts   # T2 (T3 acesso, T5 filtro)
                └── [id]/
                    ├── prontuario.ts · layout.tsx · abas.tsx · page.tsx · historico/page.tsx   # T2 (T3 acesso, T5 etiquetas)
                    ├── antropometria/** · gasto-energetico/** · anamnese/**    # T7, T8, T9
                    ├── atendimentos/** · exames/** · evolucao/**               # T10, T11, T12
                    ├── privacidade/**                                          # T13, T14
                    └── exportacoes/[exportId]/page.tsx                         # T14
```

**Ordem e dependências das tarefas:** 1 → 2 (cadastro e telas) → 3 → 4 (convite e aceite) · 5 (etiquetas; cria `staff_only`) · 6 (fórmulas, puro — pode ir a qualquer momento antes da 7) → 7 → 8 · 9 (anamnese) · 10 (atendimentos; usa `staff_only` da 5 e liga a antropometria da 7) · 11 (exames) → 12 (evolução; usa 7, 10 — a coluna `consultation_id` que a 10 acrescenta à antropometria aparece nas linhas do teste — e 11) · 13 (LGPD; usa 10 para a data da última consulta e 11 para os anexos) → 14 (exportação; lê todas as tabelas).

---
### Task 1: Cadastro de paciente — tabela `patients`, serviço, JSON com 404 fora do tenant e métricas (P03-01a)

**Files:**
- Create: `src/db/schema/pacientes.ts`, `drizzle/0016_pacientes.sql` (gerada), `drizzle/0017_rls_pacientes.sql` (custom), `src/modules/pacientes/base.ts`, `src/modules/pacientes/datas.ts`, `src/modules/pacientes/datas.test.ts`, `src/modules/pacientes/telefone.ts`, `src/modules/pacientes/telefone.test.ts`, `src/modules/pacientes/pacientes.ts`, `src/modules/pacientes/pacientes.test.ts`, `src/app/api/painel/pacientes/[id]/route.ts`, `src/app/api/painel/pacientes/[id]/route.test.ts`, `test/pacientes.ts`
- Modify: `src/db/schema/index.ts`, `src/db/rls-guard.ts` (`patients` exige `patient_isolation`), `src/modules/plataforma/metricas.test.ts` e `src/db/migrate-owner.test.ts` (`pacientes_ativos` deixa de ser nulo), `test/isolamento.test.ts` (reescrito), `src/app/admin/sem-tabelas-tenant.test.ts` (reescrito), `CLAUDE.md` (regra 9)

**Interfaces:**
- Consumes: `withTenant`, `TenantContext` (`@/db/tenant`); `getDb`, `Db`, `Tx` (`@/db/client`); `uniqueViolation` (`@/db/errors`); `auditRead` (`@/modules/plataforma/audit`); `normalizeEmail` (`@/lib/text`); `primeiroErroPorCampo` (`@/lib/validacao`); `requireApiNutri` (`@/lib/tenant-session`); `metricasPorTenant` (`@/modules/plataforma/metricas`); `criarEEntrar` (`test/sessao.ts`); `registrarAceiteDpa` (`@/modules/plataforma/dpa`); `listTenantTables`, `RLS_EXCEPTIONS` (`@/db/rls-guard`).
- Produces:
  - Schema (`@/db/schema`): `patients` 🔒, `type PatientRow`, e o `citext` exportado de `src/db/schema/pacientes.ts` para as próximas tabelas.
  - `@/modules/pacientes/base`: `MSG_BLOQUEADO`, `MSG_CADASTRO_INCOMPLETO`, `class PacienteNaoEncontradoError`, `class PacienteBloqueadoError`, `idValido(id: unknown): id is string`, `carregarPacienteParaEscrita(tx: Tx, patientId: string): Promise<PatientRow>`.
  - `@/modules/pacientes/datas`: `dataValida(iso: string): boolean`, `idadeEm(nascimento: string, em: string): number`, `hojeNoFuso(fuso: string, agora?: Date): string` (`AAAA-MM-DD`), `formatarData(iso: string): string` (`dd/mm/aaaa`).
  - `@/modules/pacientes/telefone`: `normalizarTelefone(txt: string): string | null` (E.164), `formatarTelefone(e164: string): string`.
  - `@/modules/pacientes/pacientes`: `MSG_PACIENTE`, `type TenantDoPaciente = Pick<TenantRow, 'fuso' | 'nomeExibicao'>`, `type StatusPaciente`, `type ErrosPaciente`, `class PacienteError { erros }`, `pacienteSchema(hoje: string)`, `criarPaciente(ctx, tenant, input, deps?: { db?; now?; appUrl? }): Promise<PatientRow>`, `atualizarPaciente(ctx, tenant, patientId, input, deps?): Promise<PatientRow>`, `buscarPaciente(ctx, patientId, db?): Promise<PatientRow | null>` (audita), `listarPacientes(ctx, filtro: { busca?: string; status?: StatusPaciente }, db?): Promise<PacienteNaLista[]>`, `type PacienteNaLista`.
  - Rota `GET /api/painel/pacientes/[id]` (JSON; 404 fora do tenant ou id malformado).
  - `test/pacientes.ts`: `novoTenant(db, nome?)`, `novoPaciente(db, ctx, extra?)`, `emailsNaFila(tipo, para)`, `ctxPaciente(tenantId, patientId, actorUserId?)`.
  - `test/isolamento.test.ts`: pacientes por tenant (`PAC`), `patients` semeada primeiro e apagada por último, tabelas `staff_only` com regra própria — as tarefas seguintes só acrescentam fábricas.

- [ ] **Step 1: Testes que falham de datas e telefone** — `src/modules/pacientes/datas.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { dataValida, formatarData, hojeNoFuso, idadeEm } from './datas';

describe('datas do paciente (RN-06, RN-14, RN-17)', () => {
  it('dataValida aceita só AAAA-MM-DD que existe no calendário', () => {
    expect(dataValida('1991-03-10')).toBe(true);
    expect(dataValida('2024-02-29')).toBe(true);
    for (const d of ['2026-02-30', '2025-02-29', '10/03/1991', '1991-3-10', '1899-12-31', '', 'amanhã']) expect(dataValida(d), d).toBe(false);
  });
  it('idadeEm conta anos completos; 29/02 completa ano em 01/03 nos anos comuns', () => {
    expect(idadeEm('1991-03-10', '2026-03-09')).toBe(34);
    expect(idadeEm('1991-03-10', '2026-03-10')).toBe(35);
    expect(idadeEm('2004-02-29', '2022-02-28')).toBe(17);
    expect(idadeEm('2004-02-29', '2022-03-01')).toBe(18);
  });
  it('hojeNoFuso usa o fuso do tenant: 23h30 em São Paulo ainda é o dia anterior ao UTC (Review Focus 1)', () => {
    expect(hojeNoFuso('America/Sao_Paulo', new Date('2026-03-10T02:30:00Z'))).toBe('2026-03-09');
    expect(hojeNoFuso('America/Sao_Paulo', new Date('2026-03-10T03:30:00Z'))).toBe('2026-03-10');
    expect(hojeNoFuso('America/Manaus', new Date('2026-03-10T03:30:00Z'))).toBe('2026-03-09');
  });
  it('formatarData exibe dd/mm/aaaa (RNF-12)', () => {
    expect(formatarData('2026-09-01')).toBe('01/09/2026');
  });
});
```

`src/modules/pacientes/telefone.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { formatarTelefone, normalizarTelefone } from './telefone';

describe('telefone (RNF-12: exibido (11) 91234-5678, guardado em E.164)', () => {
  it('normaliza formatos brasileiros para +55 e mantém internacional com +', () => {
    for (const t of ['(11) 91234-5678', '11 91234 5678', '11912345678', '+55 11 91234-5678', '5511912345678', '011 91234-5678']) {
      expect(normalizarTelefone(t), t).toBe('+5511912345678');
    }
    expect(normalizarTelefone('(11) 3456-7890')).toBe('+551134567890');
    expect(normalizarTelefone('+351 912 345 678')).toBe('+351912345678');
  });
  it('recusa número incompleto, DDD inválido e celular de 9 dígitos que não começa com 9', () => {
    for (const t of ['1234', '(11) 81234-5678', '(01) 91234-5678', '(11) 1234-5678', '+0 123', 'abc']) expect(normalizarTelefone(t), t).toBeNull();
    expect(normalizarTelefone('   ')).toBeNull();
  });
  it('formata E.164 brasileiro para exibição; outros países ficam como estão', () => {
    expect(formatarTelefone('+5511912345678')).toBe('(11) 91234-5678');
    expect(formatarTelefone('+551134567890')).toBe('(11) 3456-7890');
    expect(formatarTelefone('+351912345678')).toBe('+351912345678');
  });
});
```

Run: `pnpm test src/modules/pacientes/datas.test.ts src/modules/pacientes/telefone.test.ts`
Expected: FAIL — `Cannot find module './datas'` / `'./telefone'`.

- [ ] **Step 2: Implementar datas e telefone** — `src/modules/pacientes/datas.ts`

```ts
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'AAAA-MM-DD' que existe no calendário (recusa 2026-02-30) e a partir de 1900. */
export function dataValida(iso: string): boolean {
  const m = ISO.exec(iso);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return a >= 1900 && dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
}

/**
 * Anos completos na data `em` (RN-14: idade para fórmulas; RN-17: cadastro ≥ 18). Datas 'AAAA-MM-DD'.
 * Quem nasceu em 29/02 completa ano em 01/03 nos anos comuns.
 */
export function idadeEm(nascimento: string, em: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number);
  const [ae, me, de] = em.split('-').map(Number);
  return ae - an - (me < mn || (me === mn && de < dn) ? 1 : 0);
}

/** Hoje no fuso do tenant (RN-06), como 'AAAA-MM-DD' — nunca a data UTC do servidor. */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** 'AAAA-MM-DD' → 'dd/mm/aaaa' (RNF-12). */
export function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
```

`src/modules/pacientes/telefone.ts`

```ts
/**
 * Telefone digitado → E.164 (RNF-12). Sem "+", é brasileiro: DDD (11–99) + 8 dígitos (fixo, começa
 * com 2–5) ou 9 dígitos (celular, começa com 9); aceita "55" e "0" na frente. Com "+", só confere o
 * tamanho do E.164 (8 a 15 dígitos). Nada é inventado: número que não fecha vira null.
 */
export function normalizarTelefone(txt: string): string | null {
  const t = txt.trim();
  if (!t) return null;
  const digitos = t.replace(/\D/g, '');
  if (t.startsWith('+')) {
    if (digitos.startsWith('55')) return brasileiro(digitos.slice(2));
    return /^[1-9]\d{7,14}$/.test(digitos) ? `+${digitos}` : null;
  }
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return brasileiro(digitos.slice(2));
  return brasileiro(digitos.replace(/^0+/, ''));
}

function brasileiro(d: string): string | null {
  if (d.length !== 10 && d.length !== 11) return null;
  if (!/^[1-9][1-9]$/.test(d.slice(0, 2))) return null;
  const numero = d.slice(2);
  if (numero.length === 9 && numero[0] !== '9') return null;
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null;
  return `+55${d}`;
}

/** E.164 brasileiro → "(11) 91234-5678"; outros países ficam como estão. */
export function formatarTelefone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
```

Run: `pnpm test src/modules/pacientes/datas.test.ts src/modules/pacientes/telefone.test.ts`
Expected: PASS.

- [ ] **Step 3: Tabela `patients`** — criar `src/db/schema/pacientes.ts`

```ts
import { sql } from 'drizzle-orm';
import { check, customType, date, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './platform';

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Prontuário (M2). `user_id` nulo até o paciente aceitar o convite. `data_nascimento` e `sexo`
 * alimentam as fórmulas; só podem faltar em paciente do agendamento público (Plano 05) ou anonimizado.
 * `patients_tenant_id_unique` é o alvo das FKs compostas das tabelas filhas: um registro do tenant A
 * nunca aponta para paciente do tenant B, nem por bug de serviço.
 */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    nome: text('nome').notNull(),
    dataNascimento: date('data_nascimento', { mode: 'string' }),
    sexo: text('sexo'),
    telefoneE164: text('telefone_e164'),
    email: citext('email').notNull(),
    origem: text('origem').notNull().default('nutri'),
    whatsappOptinEm: timestamp('whatsapp_optin_em', { withTimezone: true }),
    whatsappOptinOrigem: text('whatsapp_optin_origem'),
    whatsappOptoutEm: timestamp('whatsapp_optout_em', { withTimezone: true }),
    status: text('status').notNull().default('ativo'),
    bloqueadoEm: timestamp('bloqueado_em', { withTimezone: true }),
    anonimizarApos: date('anonimizar_apos', { mode: 'string' }),
    anonimizadoEm: timestamp('anonimizado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patients_tenant_email_unique').on(t.tenantId, t.email),
    unique('patients_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('patients_tenant_user_idx').on(t.tenantId, t.userId).where(sql`${t.userId} is not null`),
    index('patients_tenant_status_idx').on(t.tenantId, t.status),
    check('patients_sexo_valido', sql`${t.sexo} is null or ${t.sexo} in ('F', 'M')`),
    check('patients_origem_valida', sql`${t.origem} in ('nutri', 'agendamento_publico')`),
    check('patients_status_valido', sql`${t.status} in ('ativo', 'arquivado', 'bloqueado')`),
    check('patients_optin_origem_valida', sql`${t.whatsappOptinOrigem} is null or ${t.whatsappOptinOrigem} in ('nutri', 'paciente')`),
    check('patients_telefone_e164', sql`${t.telefoneE164} is null or ${t.telefoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'patients_nascimento_e_sexo',
      sql`${t.origem} = 'agendamento_publico' or ${t.anonimizadoEm} is not null or (${t.dataNascimento} is not null and ${t.sexo} is not null)`,
    ),
  ],
);

export type PatientRow = typeof patients.$inferSelect;
```

Em `src/db/schema/index.ts`, acrescentar a linha `export * from './pacientes';`.

Run: `pnpm db:generate --name pacientes`
Expected: `drizzle/0016_pacientes.sql` com `CREATE TABLE "patients"`, as 2 UNIQUE, o índice único parcial, o índice de status, os 6 CHECKs e as FKs para `tenants` e `user` (`ON DELETE set null`). Conferir que a regex do CHECK saiu como `'^\+[1-9][0-9]{7,14}$'`.

Run: `pnpm drizzle-kit generate --custom --name rls_pacientes` e preencher `drizzle/0017_rls_pacientes.sql`:

```sql
SELECT app_enable_tenant_rls('patients');
--> statement-breakpoint
-- Sessão de paciente só vê a própria linha (a coluna do titular aqui é o próprio id)
SELECT app_enable_patient_rls('patients', 'id');
--> statement-breakpoint
SELECT app_enable_audit('patients', 'patients', 'id');
--> statement-breakpoint
-- §3: o admin passa a ver o nº de pacientes ativos (só a contagem). Mesmo corpo da 0015, trocando
-- o NULL de pacientes_ativos. CREATE OR REPLACE mantém dono e privilégios (REVOKE de PUBLIC da 0012).
CREATE OR REPLACE FUNCTION admin_tenant_metrics()
RETURNS TABLE (
  tenant_id uuid,
  arquivos bigint,
  armazenamento_bytes bigint,
  pacientes_ativos bigint,
  consultas_mes bigint,
  mensagens_whatsapp_mes bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_tenant_metrics() não pode rodar dentro de withTenant (contexto app.* de um tenant ativo)'
      USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.armazenamento_bytes AS bytes FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    tenant_id := t.id;
    armazenamento_bytes := t.bytes;
    SELECT count(*) INTO arquivos FROM public.stored_files sf WHERE sf.tenant_id = t.id;
    SELECT count(*) INTO pacientes_ativos FROM public.patients p WHERE p.tenant_id = t.id AND p.status = 'ativo';
    -- Plano 05 (appointments, notifications) troca estes NULL por contagens
    consultas_mes := NULL;
    mensagens_whatsapp_mes := NULL;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
```

Na guarda `src/db/rls-guard.ts`, `patients` guarda o titular na coluna `id` (não em `patient_id`), então a checagem de `patient_isolation` não a alcançaria. Em `findRlsViolations`, trocar a coluna `has_patient_col` por:

```sql
           (c.relname = 'patients' or exists (select 1 from information_schema.columns k where k.table_schema = 'public'
                   and k.table_name = c.relname and k.column_name = 'patient_id')) as has_patient_col,
```

e acrescentar ao `src/db/rls-guard.test.ts`, no `describe` existente:

```ts
  it('patients (titular na coluna id) também exige patient_isolation', async () => {
    const { rows } = await owner.pool.query(`select 1 from pg_policies where schemaname = 'public' and tablename = 'patients' and policyname = 'patient_isolation'`);
    expect(rows).toHaveLength(1);
  });
```

As métricas do admin passam a contar pacientes ativos: os dois testes do Plano 02 que esperavam `NULL` mudam. Em `src/modules/plataforma/metricas.test.ts`, no primeiro teste, trocar o título por `'conta arquivos e armazenamento de cada tenant; pacientes ativos contados; consultas/mensagens ainda nulos'` e `pacientesAtivos: null` por `pacientesAtivos: 0`. Em `src/db/migrate-owner.test.ts`, no teste "métricas do admin…", semear um paciente ativo e um arquivado em `a` dentro da mesma transação que grava os arquivos (logo depois do `for` de `stored_files`, com `if (t === a)`):

```ts
        if (t === a) {
          await c.query(`insert into patients (tenant_id, nome, data_nascimento, sexo, email, status) values ($1, 'Ativo', '1990-01-01', 'F', 'ativo@met.dev', 'ativo'), ($1, 'Arquivado', '1990-01-01', 'M', 'arq@met.dev', 'arquivado')`, [t]);
        }
```

e trocar `expect(rows.every((r) => r.pacientes_ativos === null)).toBe(true);` por:

```ts
      expect(Object.fromEntries(rows.map((r) => [r.tenant_id, Number(r.pacientes_ativos)]))).toEqual({ [a]: 1, [b]: 0 });
```

Run: `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/modules/plataforma/metricas.test.ts src/db/migrate-owner.test.ts`
Expected: PASS (sem a 0017, as guardas falhariam com "RLS não habilitada", "sem política patient_isolation" e "sem gatilho de auditoria" em `patients`; sem a troca dos testes, as métricas falhariam com `0 !== null`).

- [ ] **Step 4: Helpers de teste** — criar `test/pacientes.ts`

```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { patients, tenants, user, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';

export type TenantDeTeste = {
  tenantId: string;
  nutriId: string;
  ctx: TenantContext;
  tenant: { fuso: string; nomeExibicao: string };
};

/** Tenant + usuária nutricionista (o "Histórico de acessos" mostra o nome dela) e o ctx com ator e IP. */
export async function novoTenant(db: Db, nome = 'Debby Silva'): Promise<TenantDeTeste> {
  const [t] = await db.insert(tenants).values({ slug: `pc-${randomUUID().slice(0, 8)}`, nomeExibicao: nome }).returning();
  const nutriId = randomUUID();
  await db.insert(user).values({ id: nutriId, name: nome, email: `nutri-${nutriId.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: t.id });
  return {
    tenantId: t.id,
    nutriId,
    ctx: { tenantId: t.id, role: 'nutri', actorUserId: nutriId, ip: '203.0.113.20' },
    tenant: { fuso: t.fuso, nomeExibicao: t.nomeExibicao },
  };
}

/** Paciente gravado direto (sem convite nem validação), com os campos obrigatórios preenchidos. */
export async function novoPaciente(db: Db, ctx: TenantContext, extra: Partial<typeof patients.$inferInsert> = {}): Promise<PatientRow> {
  const [p] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(patients)
        .values({ tenantId: ctx.tenantId, nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: `ana-${randomUUID().slice(0, 8)}@ex.com`, ...extra })
        .returning(),
    db,
  );
  return p;
}

/** E-mails na fila (decifrados) de um tipo para um destinatário. Quem usa precisa de stopBoss() + closeDb() no afterAll. */
export async function emailsNaFila<T extends EmailMessage['tipo']>(tipo: T, para: string): Promise<Extract<EmailMessage, { tipo: T }>[]> {
  const jobs = await (await getBoss()).findJobs<EmailJobData>('email');
  return jobs
    .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
    .filter((m): m is Extract<EmailMessage, { tipo: T }> => m.tipo === tipo && m.para === para);
}

export const ctxPaciente = (tenantId: string, patientId: string, actorUserId?: string): TenantContext => ({
  tenantId,
  role: 'paciente',
  patientId,
  ...(actorUserId ? { actorUserId } : {}),
});
```

- [ ] **Step 5: Testes que falham do serviço** — `src/modules/pacientes/pacientes.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, patients, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { metricasPorTenant } from '@/modules/plataforma/metricas';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';
import { atualizarPaciente, buscarPaciente, criarPaciente, listarPacientes, MSG_PACIENTE, PacienteError } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000' };
afterAll(async () => {
  await stopBoss(); // a Tarefa 3 faz criarPaciente enfileirar o convite
  await closeDb();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
const ana = (extra: Record<string, unknown> = {}) => ({
  nome: '  Ana Souza ',
  dataNascimento: '1991-03-10',
  sexo: 'F',
  email: `Ana-${s()}@Ex.com`,
  telefone: '(11) 91234-5678',
  whatsappAutorizado: false,
  ...extra,
});
const erroDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PacienteError) return e.erros;
    throw e;
  }
  throw new Error('esperava PacienteError');
};
const logDe = (ctx: Parameters<typeof withTenant>[0], id: string) =>
  withTenant(ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, id)).orderBy(auditLog.criadoEm), app.db);

describe('criarPaciente (US-010, RN-17)', () => {
  it('cria ativo, sem usuário, com e-mail em minúsculas, telefone em E.164 e auditoria "criar" com a nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ whatsappAutorizado: true }), deps);
    expect(p).toMatchObject({ status: 'ativo', userId: null, nome: 'Ana Souza', sexo: 'F', telefoneE164: '+5511912345678', origem: 'nutri', whatsappOptinOrigem: 'nutri' });
    expect(p.email).toMatch(/^ana-.+@ex\.com$/);
    expect(p.whatsappOptinEm?.toISOString()).toBe(now.toISOString());
    const log = await logDe(T.ctx, p.id);
    expect(log[0]).toMatchObject({ acao: 'criar', entidade: 'patients', patientId: p.id, actorUserId: T.nutriId, ip: '203.0.113.20' });
  });

  it('mensagens exatas da spec para nome, idade, sexo e telefone; WhatsApp autorizado exige telefone', async () => {
    const T = await novoTenant(app.db);
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ nome: 'A' }), deps))).toEqual({ nome: MSG_PACIENTE.nome });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ dataNascimento: '2010-01-01' }), deps))).toEqual({
      dataNascimento: 'O sistema atende apenas pacientes a partir de 18 anos',
    });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ dataNascimento: '2026-02-30' }), deps))).toEqual({ dataNascimento: MSG_PACIENTE.nascimentoInvalido });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ dataNascimento: '1900-01-01' }), deps))).toEqual({ dataNascimento: MSG_PACIENTE.nascimentoInvalido });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ sexo: '' }), deps))).toEqual({ sexo: 'Selecione o sexo biológico (usado nas fórmulas)' });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ telefone: '1234' }), deps))).toEqual({ telefone: 'Telefone inválido' });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ telefone: '', whatsappAutorizado: true }), deps))).toEqual({
      whatsappAutorizado: MSG_PACIENTE.whatsappSemTelefone,
    });
  });

  it('18 anos no fuso do tenant: 23h30 em São Paulo do dia anterior ao aniversário ainda recusa (Review Focus 1)', async () => {
    const T = await novoTenant(app.db);
    const nasc = { dataNascimento: '2008-03-10' };
    const vespera = { ...deps, now: new Date('2026-03-10T02:30:00Z') }; // 09/03 23h30 em São Paulo
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana(nasc), vespera))).toEqual({ dataNascimento: MSG_PACIENTE.menorDeIdade });
    const dia = { ...deps, now: new Date('2026-03-10T03:30:00Z') }; // 10/03 00h30 em São Paulo
    await expect(criarPaciente(T.ctx, T.tenant, ana(nasc), dia)).resolves.toMatchObject({ dataNascimento: '2008-03-10' });
  });

  it('e-mail repetido no tenant, sem diferenciar maiúsculas e mesmo em envios simultâneos: um só paciente (Review Focus 5)', async () => {
    const T = await novoTenant(app.db);
    const email = `dup-${s()}@ex.com`;
    const r = await Promise.allSettled([email.toUpperCase(), email, ` ${email} `].map((e) => criarPaciente(T.ctx, T.tenant, ana({ email: e }), deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const f of r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(f.reason).toBeInstanceOf(PacienteError);
      expect((f.reason as PacienteError).erros).toEqual({ email: 'Paciente já cadastrado com este e-mail' });
    }
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, email)), app.db);
    expect(linhas).toHaveLength(1);
  });

  it('o mesmo e-mail em outra nutricionista é aceito (cada tenant tem o seu prontuário)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const email = `dois-${s()}@ex.com`;
    await criarPaciente(A.ctx, A.tenant, ana({ email }), deps);
    await expect(criarPaciente(B.ctx, B.tenant, ana({ email }), deps)).resolves.toMatchObject({ tenantId: B.tenantId });
  });
});

describe('atualizarPaciente', () => {
  it('altera o cadastro; desmarcar a autorização apaga o opt-in da nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ whatsappAutorizado: true }), deps);
    const q = await atualizarPaciente(T.ctx, T.tenant, p.id, ana({ nome: 'Ana S. Lima', email: p.email, whatsappAutorizado: false }), deps);
    expect(q).toMatchObject({ nome: 'Ana S. Lima', whatsappOptinEm: null, whatsappOptinOrigem: null });
  });

  it('com acesso ativo o e-mail não muda; bloqueado é só leitura; id de outro tenant ou malformado = não encontrado', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    // Conta de paciente já vinculada (o aceite do convite é da Tarefa 4)
    const uid = randomUUID();
    await app.db.insert(user).values({ id: uid, name: 'Ana Souza', email: `conta-${uid.slice(0, 8)}@ex.com`, appRole: 'paciente' });
    const comConta = await novoPaciente(app.db, A.ctx, { userId: uid });
    expect(await erroDe(atualizarPaciente(A.ctx, A.tenant, comConta.id, ana({ email: `outro-${s()}@ex.com` }), deps))).toEqual({
      email: 'O paciente já ativou o acesso; o e-mail não pode ser alterado.',
    });
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(atualizarPaciente(A.ctx, A.tenant, bloqueado.id, ana({ email: bloqueado.email }), deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(atualizarPaciente(A.ctx, A.tenant, deB.id, ana({ email: deB.email }), deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(atualizarPaciente(A.ctx, A.tenant, 'abc', ana(), deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const [intacto] = await withTenant(B.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, deB.id)), app.db);
    expect(intacto.nome).toBe('Ana Souza');
  });
});

describe('buscarPaciente e listarPacientes', () => {
  it('abrir o prontuário grava a leitura (US-007); outro tenant ou id malformado devolve null sem auditar', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const p = await novoPaciente(app.db, A.ctx);
    expect(await buscarPaciente(A.ctx, p.id, app.db)).toMatchObject({ id: p.id });
    const log = await logDe(A.ctx, p.id);
    expect(log.at(-1)).toMatchObject({ acao: 'ler', entidade: 'patients', patientId: p.id, actorUserId: A.nutriId });
    expect(await buscarPaciente(B.ctx, p.id, app.db)).toBeNull();
    expect(await buscarPaciente(A.ctx, 'nao-e-uuid', app.db)).toBeNull();
    expect(await withTenant(B.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, p.id)), app.db)).toEqual([]);
  });

  it('busca sem acento por nome e por e-mail; "%" é literal; por padrão só ativos', async () => {
    const T = await novoTenant(app.db);
    await novoPaciente(app.db, T.ctx, { nome: 'José Araújo', email: `jose-${s()}@ex.com` });
    await novoPaciente(app.db, T.ctx, { nome: 'Maria Lima', email: `maria-${s()}@ex.com` });
    await novoPaciente(app.db, T.ctx, { nome: 'João Arquivado', status: 'arquivado' });
    expect((await listarPacientes(T.ctx, { busca: 'jose araujo' }, app.db)).map((x) => x.nome)).toEqual(['José Araújo']);
    expect((await listarPacientes(T.ctx, { busca: 'MARIA-' }, app.db)).map((x) => x.nome)).toEqual(['Maria Lima']);
    expect(await listarPacientes(T.ctx, { busca: '%' }, app.db)).toEqual([]);
    expect((await listarPacientes(T.ctx, {}, app.db)).map((x) => x.nome)).toEqual(['José Araújo', 'Maria Lima']);
    expect((await listarPacientes(T.ctx, { status: 'arquivado' }, app.db)).map((x) => x.nome)).toEqual(['João Arquivado']);
  });

  it('sessão de paciente só enxerga a própria linha de patients (RLS por paciente)', async () => {
    const T = await novoTenant(app.db);
    const p1 = await novoPaciente(app.db, T.ctx);
    await novoPaciente(app.db, T.ctx);
    const vistos = await withTenant(ctxPaciente(T.tenantId, p1.id), (tx) => tx.select({ id: patients.id }).from(patients), app.db);
    expect(vistos).toEqual([{ id: p1.id }]);
  });

  it('o admin vê só a contagem de pacientes ativos (§3)', async () => {
    const T = await novoTenant(app.db);
    await novoPaciente(app.db, T.ctx);
    await novoPaciente(app.db, T.ctx);
    await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    expect((await metricasPorTenant(app.db)).get(T.tenantId)?.pacientesAtivos).toBe(2);
  });
});

it('a linha criada por paciente de outro tenant nunca aparece na busca do tenant A', async () => {
  const A = await novoTenant(app.db);
  const B = await novoTenant(app.db);
  await novoPaciente(app.db, B.ctx, { nome: 'Somente B' });
  expect(await listarPacientes(A.ctx, { busca: 'Somente' }, app.db)).toEqual([]);
  const [linha] = await withTenant(B.ctx, (tx) => tx.select().from(patients).where(and(eq(patients.tenantId, B.tenantId), eq(patients.nome, 'Somente B'))), app.db);
  expect(linha).toBeDefined();
});
```

Run: `pnpm test src/modules/pacientes/pacientes.test.ts`
Expected: FAIL — `Cannot find module './base'` / `'./pacientes'`.

- [ ] **Step 6: Implementar `base.ts` e `pacientes.ts`** — `src/modules/pacientes/base.ts`

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '@/db/client';
import { patients, type PatientRow } from '@/db/schema';

export const MSG_BLOQUEADO = 'Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.';
export const MSG_CADASTRO_INCOMPLETO = 'Complete a data de nascimento e o sexo do paciente no cadastro.';

export class PacienteNaoEncontradoError extends Error {
  override name = 'PacienteNaoEncontradoError';
  constructor() {
    super('Paciente não encontrado');
  }
}

export class PacienteBloqueadoError extends Error {
  override name = 'PacienteBloqueadoError';
  constructor() {
    super(MSG_BLOQUEADO);
  }
}

/** O id costuma vir da URL; sem isto, o cast para uuid no Postgres vira erro 500 (M6/G5 do Plano 02). */
export const idValido = (id: unknown): id is string => typeof id === 'string' && z.guid().safeParse(id).success;

/**
 * Paciente travado (FOR UPDATE) antes de qualquer escrita no prontuário. Chamar dentro de withTenant:
 * a RLS já esconde paciente de outro tenant (→ não encontrado). Bloqueado ou anonimizado é só leitura
 * (US-018 "mantido … só para consulta da nutricionista"). Arquivado continua editável.
 */
export async function carregarPacienteParaEscrita(tx: Tx, patientId: string): Promise<PatientRow> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p) throw new PacienteNaoEncontradoError();
  if (p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
  return p;
}
```

`src/modules/pacientes/pacientes.ts`

```ts
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { patients, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizeEmail } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido, PacienteNaoEncontradoError } from './base';
import { dataValida, hojeNoFuso, idadeEm } from './datas';
import { normalizarTelefone } from './telefone';

export const MSG_PACIENTE = {
  nome: 'Informe o nome',
  nascimentoInvalido: 'Informe uma data de nascimento válida',
  menorDeIdade: 'O sistema atende apenas pacientes a partir de 18 anos',
  sexo: 'Selecione o sexo biológico (usado nas fórmulas)',
  email: 'Informe um e-mail válido',
  emailDuplicado: 'Paciente já cadastrado com este e-mail',
  telefone: 'Telefone inválido',
  whatsappSemTelefone: 'Informe o telefone para registrar a autorização de WhatsApp',
  emailBloqueado: 'O paciente já ativou o acesso; o e-mail não pode ser alterado.',
} as const;

export type TenantDoPaciente = Pick<TenantRow, 'fuso' | 'nomeExibicao'>;
export type StatusPaciente = 'ativo' | 'arquivado' | 'bloqueado';
export type ErrosPaciente = Partial<Record<'nome' | 'dataNascimento' | 'sexo' | 'email' | 'telefone' | 'whatsappAutorizado' | 'geral', string>>;

export class PacienteError extends Error {
  override name = 'PacienteError';
  constructor(readonly erros: ErrosPaciente) {
    super('Dados do paciente inválidos');
  }
}

/** US-010 + RN-17. `hoje` = data no fuso do tenant (RN-06): a idade de 18 anos vale no dia do consultório. */
export function pacienteSchema(hoje: string) {
  return z
    .object({
      nome: z.string().trim().min(2, MSG_PACIENTE.nome).max(120, MSG_PACIENTE.nome),
      dataNascimento: z
        .string()
        .trim()
        .superRefine((v, ctx) => {
          if (!dataValida(v)) return void ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.nascimentoInvalido });
          const idade = idadeEm(v, hoje);
          if (idade < 18) ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.menorDeIdade });
          else if (idade > 120) ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.nascimentoInvalido });
        }),
      sexo: z.enum(['F', 'M'], { message: MSG_PACIENTE.sexo }),
      email: z.string().transform(normalizeEmail).pipe(z.email({ message: MSG_PACIENTE.email })),
      telefone: z
        .string()
        .trim()
        .transform((v, ctx) => {
          if (!v) return null;
          const e164 = normalizarTelefone(v);
          if (!e164) {
            ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.telefone });
            return z.NEVER;
          }
          return e164;
        }),
      whatsappAutorizado: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.whatsappAutorizado && !v.telefone) {
        ctx.addIssue({ code: 'custom', path: ['whatsappAutorizado'], message: MSG_PACIENTE.whatsappSemTelefone });
      }
    });
}

type DadosPaciente = z.output<ReturnType<typeof pacienteSchema>>;
type Deps = { db?: Db; now?: Date; appUrl?: string };

function validar(tenant: TenantDoPaciente, input: Record<string, unknown>, now: Date): DadosPaciente {
  const r = pacienteSchema(hojeNoFuso(tenant.fuso, now)).safeParse(input);
  if (!r.success) throw new PacienteError(primeiroErroPorCampo(r.error));
  return r.data;
}

function comoDuplicado(err: unknown): never {
  if (uniqueViolation(err) === 'patients_tenant_email_unique') throw new PacienteError({ email: MSG_PACIENTE.emailDuplicado });
  throw err;
}

/** Autorização presencial (INT-01, `origem = 'nutri'`). O opt-out do próprio paciente nunca é desfeito aqui. */
function autorizacaoWhatsapp(autorizado: boolean, atual: Pick<PatientRow, 'whatsappOptinEm'> | null, now: Date) {
  if (autorizado) return atual?.whatsappOptinEm ? {} : { whatsappOptinEm: now, whatsappOptinOrigem: 'nutri' };
  return { whatsappOptinEm: null, whatsappOptinOrigem: null };
}

/**
 * US-010: paciente `ativo`, `user_id` nulo. Em corrida, quem decide o e-mail repetido é a UNIQUE
 * (tenant_id, email) em citext — sem pré-checagem.
 */
export async function criarPaciente(ctx: TenantContext, tenant: TenantDoPaciente, input: Record<string, unknown>, deps: Deps = {}): Promise<PatientRow> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const v = validar(tenant, input, now);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const [p] = await tx
          .insert(patients)
          .values({
            tenantId: ctx.tenantId,
            nome: v.nome,
            dataNascimento: v.dataNascimento,
            sexo: v.sexo,
            email: v.email,
            telefoneE164: v.telefone,
            origem: 'nutri',
            ...autorizacaoWhatsapp(v.whatsappAutorizado, null, now),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return p;
      },
      db,
    );
  } catch (err) {
    return comoDuplicado(err);
  }
}

export async function atualizarPaciente(
  ctx: TenantContext,
  tenant: TenantDoPaciente,
  patientId: string,
  input: Record<string, unknown>,
  deps: Deps = {},
): Promise<PatientRow> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const v = validar(tenant, input, now);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const atual = await carregarPacienteParaEscrita(tx, patientId);
        // O login do paciente é pelo e-mail: depois do aceite, trocar aqui separaria conta e prontuário
        if (atual.userId && v.email !== normalizeEmail(atual.email)) throw new PacienteError({ email: MSG_PACIENTE.emailBloqueado });
        const [p] = await tx
          .update(patients)
          .set({
            nome: v.nome,
            dataNascimento: v.dataNascimento,
            sexo: v.sexo,
            email: v.email,
            telefoneE164: v.telefone,
            ...autorizacaoWhatsapp(v.whatsappAutorizado, atual, now),
            updatedAt: now,
          })
          .where(eq(patients.id, patientId))
          .returning();
        return p;
      },
      db,
    );
  } catch (err) {
    return comoDuplicado(err);
  }
}

/** Abrir o prontuário (US-007 "Leitura auditada"): a leitura vai para o audit_log na mesma transação. */
export async function buscarPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<PatientRow | null> {
  if (!idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      if (!p) return null;
      await auditRead(tx, { entidade: 'patients', entidadeId: p.id, patientId: p.id });
      return p;
    },
    db,
  );
}

export const LIMITE_LISTA = 500;
export type PacienteNaLista = Pick<PatientRow, 'id' | 'nome' | 'email' | 'status' | 'dataNascimento' | 'userId' | 'origem'>;

/**
 * Lista do painel (nome e contato, sem dado clínico — não audita; abrir o prontuário audita).
 * Busca sem acento por nome ou e-mail; `%`, `_` e `\` digitados são literais.
 */
export async function listarPacientes(ctx: TenantContext, filtro: { busca?: string; status?: StatusPaciente }, db: Db = getDb()): Promise<PacienteNaLista[]> {
  const conds: SQL[] = [eq(patients.status, filtro.status ?? 'ativo')];
  const busca = filtro.busca?.trim();
  if (busca) {
    const termo = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql`(unaccent(${patients.nome}) ilike unaccent(${termo}) or ${patients.email}::text ilike ${termo})`);
  }
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({
          id: patients.id,
          nome: patients.nome,
          email: patients.email,
          status: patients.status,
          dataNascimento: patients.dataNascimento,
          userId: patients.userId,
          origem: patients.origem,
        })
        .from(patients)
        .where(and(...conds))
        .orderBy(asc(patients.nome))
        .limit(LIMITE_LISTA),
    db,
  );
}
```

Run: `pnpm test src/modules/pacientes/pacientes.test.ts`
Expected: PASS.

- [ ] **Step 7: JSON do paciente com 404 fora do tenant (US-006)** — teste `src/app/api/painel/pacientes/[id]/route.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from '../../../../../../test/sessao';
import { novoPaciente } from '../../../../../../test/pacientes';
import { GET } from './route';

vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function nutriComDpa() {
  const [t] = await db.insert(tenants).values({ slug: `ap-${randomUUID().slice(0, 8)}`, nomeExibicao: 'AP' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { tenantId: t.id, cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
const pedir = (id: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/pacientes/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

describe('GET /api/painel/pacientes/[id] (US-006 "Acesso por ID de outro tenant na API")', () => {
  it('200 com o cadastro para a própria nutricionista; 404 para paciente de outro tenant e para id malformado', async () => {
    const A = await nutriComDpa();
    const B = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx, { telefoneE164: '+5511912345678' });
    const ok = await pedir(p.id, A.cookie);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      id: p.id, nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: p.email, telefone: '(11) 91234-5678', status: 'ativo', acessoAtivo: false,
    });
    const outro = await pedir(p.id, B.cookie);
    expect(outro.status).toBe(404);
    expect(await outro.json()).toEqual({ erro: 'Paciente não encontrado' });
    expect((await pedir('abc', A.cookie)).status).toBe(404);
  });

  it('sem sessão 401; admin 403', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    expect((await pedir(p.id)).status).toBe(401);
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    expect((await pedir(p.id, admin.cookie)).status).toBe(403);
  });
});
```

Run: `pnpm test src/app/api/painel/pacientes/[id]/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

Implementar `src/app/api/painel/pacientes/[id]/route.ts`:

```ts
import { requireApiNutri } from '@/lib/tenant-session';
import { buscarPaciente } from '@/modules/pacientes/pacientes';
import { formatarTelefone } from '@/modules/pacientes/telefone';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'cache-control': 'no-store' };

/** US-006: paciente fora do tenant (a RLS esconde) ou id malformado → 404, nunca 403 nem 500. */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  const p = await buscarPaciente(acesso.ctx, id);
  if (!p) return Response.json({ erro: 'Paciente não encontrado' }, { status: 404, headers: SEM_CACHE });
  return Response.json(
    {
      id: p.id,
      nome: p.nome,
      dataNascimento: p.dataNascimento,
      sexo: p.sexo,
      email: p.email,
      telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : null,
      status: p.status,
      acessoAtivo: p.userId !== null,
    },
    { headers: SEM_CACHE },
  );
}
```

Run: `pnpm test src/app/api/painel/pacientes/[id]/route.test.ts`
Expected: PASS.

- [ ] **Step 8: Matriz de isolamento com pacientes de verdade** — substituir `test/isolamento.test.ts` inteiro por:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from './db';
import { tenants } from '@/db/schema';
import { listTenantTables, RLS_EXCEPTIONS } from '@/db/rls-guard';
import { withTenant } from '@/db/tenant';

/**
 * RNF-07: "tenta ler, alterar e excluir dados de outro tenant e de outro paciente do mesmo tenant
 * em todas as tabelas 🔒". Cada tabela nova com tenant_id PRECISA de uma fábrica aqui.
 *
 * PF-F3: as fábricas semeiam os DOIS tenants (A e B), cada um com os seus dois pacientes, para que o
 * teste falhe tanto se uma política negar tudo quanto se liberar tudo.
 * P03: as tabelas filhas têm FK composta (tenant_id, patient_id) → patients, então cada tenant tem os
 * próprios pacientes (PAC) e `patients` é semeada primeiro e apagada por último (ULTIMAS).
 * Fábrica que precisa de uma linha-mãe (etiqueta, atendimento) cria a mãe no mesmo comando (CTE).
 */
const FABRICAS: Record<string, (tenantId: string, patientId: string) => SQL> = {
  audit_log: (t, p) => sql`insert into audit_log (tenant_id, acao, entidade, patient_id) values (${t}, 'ler', 'isolamento', ${p})`,
  stored_files: (t) =>
    sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values (${t}, 'logo', ${`${t}/logo/${randomUUID()}.png`}, 1, 'image/png')`,
  rls_fixture_patient_items: (t, p) => sql`insert into rls_fixture_patient_items (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  audit_fixture_registros: (t, p) => sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  patients: (t, p) =>
    sql`insert into patients (id, tenant_id, nome, data_nascimento, sexo, email) values (${p}, ${t}, 'Iso', '1990-01-01', 'F', ${`iso-${p}@teste.dev`})`,
};
/** Tabelas append-only: UPDATE/DELETE já são negados por permissão. */
const SO_INSERE = new Set(['audit_log']);
/** Apagadas por último no teste de DELETE (as filhas têm FK NO ACTION para elas). */
const ULTIMAS = ['anamnesis_templates', 'patients'];

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let A: string;
let B: string;
let PAC: Record<string, [string, string]> = {};
let P1: string;
let P2: string;
let tabelas: string[] = [];
let soEquipe = new Set<string>();

const naOrdemDeCriacao = (ts: string[]) => [...ts.filter((t) => t === 'patients'), ...ts.filter((t) => t !== 'patients')];
const naOrdemDeExclusao = (ts: string[]) => [...ts.filter((t) => !ULTIMAS.includes(t)), ...ULTIMAS.filter((t) => ts.includes(t))];

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `iso-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso A' },
      { slug: `iso-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  PAC = { [A]: [randomUUID(), randomUUID()], [B]: [randomUUID(), randomUUID()] };
  [P1, P2] = PAC[A];
  tabelas = naOrdemDeCriacao((await listTenantTables(owner.pool)).filter((t) => !RLS_EXCEPTIONS[t]));
  soEquipe = new Set(
    (await owner.pool.query<{ t: string }>(`select tablename as t from pg_policies where schemaname = 'public' and policyname = 'staff_only'`)).rows.map((r) => r.t),
  );
  for (const t of tabelas) {
    if (!FABRICAS[t]) continue;
    for (const tenantId of [A, B]) {
      for (const p of PAC[tenantId]) await withTenant({ tenantId, role: 'nutri' }, (tx) => tx.execute(FABRICAS[t](tenantId, p)), app.db);
    }
  }
});
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

/** Coluna do titular por tabela: em `patients` é o próprio `id` (app_enable_patient_rls('patients', 'id')). */
const COLUNA_TITULAR: Record<string, string> = { patients: 'id' };
/** O paciente nunca é apagado (arquiva, bloqueia, anonimiza), e as filhas `staff_only`, invisíveis para P2, seguram a FK. */
const SEM_DELETE_DO_PACIENTE = new Set(['patients']);

const colunaTitular = async (t: string): Promise<string | null> => {
  if (COLUNA_TITULAR[t]) return COLUNA_TITULAR[t];
  const r = await owner.pool.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'patient_id'`,
    [t],
  );
  return r.rowCount! > 0 ? 'patient_id' : null;
};

const contarTenant = async (t: string, tenantId: string) =>
  Number((await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1`, [tenantId])).rows[0].n);

/** Recusa pela política da RLS (WITH CHECK), não por outro motivo qualquer. */
const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};

const contarPaciente = async (t: string, col: string, tenantId: string, patientId: string) =>
  Number(
    (await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1 and "${col}" = $2`, [tenantId, patientId]))
      .rows[0].n,
  );

describe('isolamento em todas as tabelas 🔒 (RNF-07, US-006)', () => {
  it('toda tabela com tenant_id tem fábrica neste teste', () => {
    expect(tabelas.filter((t) => !FABRICAS[t])).toEqual([]);
  });

  // M12: roda antes dos testes que apagam as linhas de B/P2 (o UPDATE precisa de linhas visíveis)
  it('WITH CHECK: o tenant B não grava linha com o tenant_id de A nem move a própria linha para A', async () => {
    for (const t of tabelas) {
      const antesA = await contarTenant(t, A);
      const comoB = (q: SQL) => withTenant({ tenantId: B, role: 'nutri' }, (tx) => tx.execute(q), app.db);
      await expect(comoB(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRls);
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, B), t).toBeGreaterThan(0); // há linha de B para tentar mover
        await expect(comoB(sql`update ${sql.identifier(t)} set tenant_id = ${A}`), t).rejects.toSatisfy(violaRls);
      }
      expect(await contarTenant(t, A), t).toBe(antesA);
    }
  });

  it('WITH CHECK: a paciente P2 não grava linha de P1 nem move a própria linha para P1 (inclusive em patients)', async () => {
    for (const t of tabelas) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t)) continue;
      const antesP1 = await contarPaciente(t, col, A, P1);
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, (tx) => tx.execute(q), app.db);
      // a RLS (42501) é conferida antes da PK/UNIQUE e da FK: em patients o INSERT com id = P1 cai na política
      await expect(comoP2(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRls);
      if (!SO_INSERE.has(t)) {
        expect(await contarPaciente(t, col, A, P2), t).toBeGreaterThan(0);
        await expect(comoP2(sql`update ${sql.identifier(t)} set ${sql.identifier(col)} = ${P1}`), t).rejects.toSatisfy(violaRls);
      }
      expect(await contarPaciente(t, col, A, P1), t).toBe(antesP1);
    }
  });

  it('staff_only: a sessão de paciente não vê nem grava nada nessas tabelas, nem as próprias linhas (US-016, US-019)', async () => {
    for (const t of tabelas.filter((x) => soEquipe.has(x))) {
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, (tx) => tx.execute(q), app.db);
      const vistas = await comoP2(sql`select 1 from ${sql.identifier(t)}`);
      expect(vistas.rows.length, t).toBe(0);
      await expect(comoP2(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRls);
    }
  });

  it('o tenant B só vê e só altera as próprias linhas; as de A ficam intactas', async () => {
    for (const t of naOrdemDeExclusao(tabelas)) {
      const id = sql.identifier(t);
      const antesA = await contarTenant(t, A);
      await withTenant(
        { tenantId: B, role: 'nutri' },
        async (tx) => {
          // SELECT sem filtro: RLS precisa devolver só (e todas) as linhas de B — não zero (política que nega
          // tudo) nem inclui A (política que libera tudo).
          const vistas = await tx.execute(sql`select tenant_id from ${id}`);
          expect(vistas.rows.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.tenant_id, t).toBe(B);
          if (SO_INSERE.has(t)) return;
          // UPDATE e DELETE sem filtro: só podem afetar as linhas que a própria RLS já mostrou (as de B).
          const alteradas = await tx.execute(sql`update ${id} set tenant_id = tenant_id`);
          expect(alteradas.rowCount, t).toBe(vistas.rows.length);
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(vistas.rows.length);
        },
        app.db,
      );
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, A), t).toBe(antesA); // owner confirma: A não foi tocado
        expect(await contarTenant(t, B), t).toBe(0); // e o DELETE de B de fato aconteceu
      }
    }
  });

  it('a paciente P2 só vê e só altera as próprias linhas; as de P1 (mesmo tenant) ficam intactas (inclusive em patients)', async () => {
    for (const t of naOrdemDeExclusao(tabelas)) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t)) continue;
      const id = sql.identifier(t);
      const c = sql.identifier(col);
      const antesP1 = await contarPaciente(t, col, A, P1);
      const apaga = !SO_INSERE.has(t) && !SEM_DELETE_DO_PACIENTE.has(t);
      await withTenant(
        { tenantId: A, role: 'paciente', patientId: P2 },
        async (tx) => {
          const vistas = await tx.execute(sql`select ${c} as titular from ${id}`);
          expect(vistas.rows.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.titular, t).toBe(P2);
          if (SO_INSERE.has(t)) return;
          const alteradas = await tx.execute(sql`update ${id} set ${c} = ${c}`);
          expect(alteradas.rowCount, t).toBe(vistas.rows.length);
          if (!apaga) return;
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(vistas.rows.length);
        },
        app.db,
      );
      expect(await contarPaciente(t, col, A, P1), t).toBe(antesP1); // owner confirma: as linhas de P1 seguem intactas
      if (apaga) expect(await contarPaciente(t, col, A, P2), t).toBe(0); // e o DELETE de P2 de fato aconteceu
    }
  });
});
```

Run: `pnpm test test/isolamento.test.ts`
Expected: PASS (6 testes; o de `staff_only` passa sem iterar nada até a Tarefa 5). Conferir: removendo a fábrica `patients`, o primeiro teste falha listando `patients`; trocando temporariamente o `app_enable_patient_rls('patients', 'id')` da 0017 por nada (banco de teste recriado), os dois testes de P2 falham em `patients`.

- [ ] **Step 9: Guarda do admin derivada do schema** — substituir `src/app/admin/sem-tabelas-tenant.test.ts` inteiro por:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { RLS_EXCEPTIONS } from '@/db/rls-guard';

const ARQUIVOS_DO_ADMIN = [
  ...readdirSync(path.resolve('src/app/admin'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => path.join(d.parentPath, d.name)),
  path.resolve('src/modules/plataforma/contas.ts'),
  path.resolve('src/modules/plataforma/metricas.ts'),
  path.resolve('src/modules/plataforma/monitoramento.ts'),
  path.resolve('src/modules/plataforma/suspensao.ts'),
];

/**
 * Item adiado do Plano 02 (T9): a lista de tabelas 🔒 vem do próprio schema — toda tabela com
 * `tenantId` que não está nas exceções de RLS —, pelo nome no código e pelo nome no banco.
 */
const TABELAS_TENANT = Object.entries(schema)
  .filter(([, v]) => is(v, PgTable) && 'tenantId' in getTableColumns(v as PgTable))
  .map(([js, v]) => ({ js, sql: getTableName(v as PgTable) }))
  .filter((t) => !RLS_EXCEPTIONS[t.sql]);
const PROIBIDO = new RegExp(`\\b(withTenant|${TABELAS_TENANT.flatMap((t) => [t.js, t.sql]).join('|')})\\b`);

describe('§4.1: o admin nunca consulta tabelas 🔒', () => {
  it('a lista derivada do schema inclui as tabelas conhecidas', () => {
    expect(TABELAS_TENANT.map((t) => t.sql)).toEqual(expect.arrayContaining(['audit_log', 'stored_files', 'patients']));
  });
  it.each(ARQUIVOS_DO_ADMIN)('%s não acessa tabelas com tenant_id', (arquivo) => {
    expect(readFileSync(arquivo, 'utf8')).not.toMatch(PROIBIDO);
  });
});
```

Run: `pnpm test src/app/admin/sem-tabelas-tenant.test.ts`
Expected: PASS. Conferir que falha se `src/app/admin/page.tsx` ganhar temporariamente a palavra `patients` (desfazer depois).

- [ ] **Step 10: CLAUDE.md** — na regra 9, trocar "Tabela nova com `tenant_id` também entra em `FABRICAS` de `test/isolamento.test.ts`." por:

```markdown
Tabela nova com `tenant_id` também entra em `FABRICAS` de `test/isolamento.test.ts` (fábrica que precisa de linha-mãe cria a mãe no mesmo comando; tabela-mãe com FK `NO ACTION` entra em `ULTIMAS`).
```

- [ ] **Step 11: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/db/schema/pacientes.ts src/db/schema/index.ts drizzle/0016_pacientes.sql drizzle/0017_rls_pacientes.sql drizzle/meta \
  src/modules/pacientes test/pacientes.ts test/isolamento.test.ts src/app/admin/sem-tabelas-tenant.test.ts \
  src/db/rls-guard.ts src/db/rls-guard.test.ts src/modules/plataforma/metricas.test.ts src/db/migrate-owner.test.ts \
  'src/app/api/painel/pacientes/[id]' CLAUDE.md
git commit -m "feat(pacientes): cadastro com RLS por tenant e paciente, idade no fuso, E.164, JSON com 404 fora do tenant e métricas de ativos (P03-01a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Telas do cadastro — lista, novo paciente, prontuário com abas e "Histórico de acessos" (P03-01b)

**Files:**
- Create: `src/app/painel/pacientes/page.tsx`, `src/app/painel/pacientes/novo/page.tsx`, `src/app/painel/pacientes/actions.ts`, `src/app/painel/pacientes/paciente-form.tsx`, `src/app/painel/pacientes/[id]/prontuario.ts`, `src/app/painel/pacientes/[id]/layout.tsx`, `src/app/painel/pacientes/[id]/abas.tsx`, `src/app/painel/pacientes/[id]/page.tsx`, `src/app/painel/pacientes/[id]/historico/page.tsx`, `src/app/painel/pacientes/valores.ts`, `src/app/painel/pacientes/valores.test.ts`, `e2e/pacientes.spec.ts`
- Modify: `src/app/painel/cabecalho.tsx`

**Interfaces:**
- Consumes: `requireNutri` (`@/lib/tenant-session`); `criarPaciente`, `atualizarPaciente`, `buscarPaciente`, `listarPacientes`, `PacienteError`, `type ErrosPaciente`, `type StatusPaciente` (Tarefa 1); `PacienteBloqueadoError`, `PacienteNaoEncontradoError` (Tarefa 1, `base.ts`); `idadeEm`, `hojeNoFuso`, `formatarData` (Tarefa 1); `formatarTelefone` (Tarefa 1); `HistoricoAcessos` (`@/modules/plataforma/ui/historico-acessos`); `Campo` (`@/components/campo`); `Cabecalho` (`src/app/painel/cabecalho.tsx`); `entrarComo` (`e2e/helpers.ts`).
- Produces:
  - `src/app/painel/pacientes/valores.ts`: `type ValoresPaciente = { nome; dataNascimento; sexo; email; telefone; whatsappAutorizado: boolean }`, `valoresDoFormulario(f: FormData): ValoresPaciente`, `valoresDoPaciente(p: PatientRow): ValoresPaciente`, `seloDoPaciente(p): string | null`.
  - `src/app/painel/pacientes/actions.ts`: `type PacienteState`, `criarPacienteAction`, `atualizarPacienteAction(patientId, prev, formData)`.
  - `src/app/painel/pacientes/paciente-form.tsx`: `PacienteForm({ acao, inicial, botao, emailBloqueado?, somenteLeitura? })`.
  - `src/app/painel/pacientes/[id]/prontuario.ts`: `carregarProntuario(id: string)` (React `cache`: uma leitura auditada por requisição, compartilhada entre layout e página) → `NutriAccess & { paciente: PatientRow }`.
  - `src/app/painel/pacientes/[id]/abas.tsx`: `ABAS` (lista `{ seg, rotulo }`; cada tarefa acrescenta a sua aba **antes** de `historico`) e `Abas({ patientId })`.
  - `e2e/pacientes.spec.ts`: suíte serial com a nutricionista do seed (`nutri-e2e@nutridebby.test`) e o paciente `ANA` — as Tarefas 4, 7, 9 e 13 acrescentam testes.

- [ ] **Step 1: Testes que falham dos valores do formulário** — `src/app/painel/pacientes/valores.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { PatientRow } from '@/db/schema';
import { seloDoPaciente, valoresDoFormulario, valoresDoPaciente } from './valores';

const base = {
  id: 'p', tenantId: 't', userId: null, nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', telefoneE164: '+5511912345678',
  email: 'ana@ex.com', origem: 'nutri', whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri', whatsappOptoutEm: null,
  status: 'ativo', bloqueadoEm: null, anonimizarApos: null, anonimizadoEm: null, createdAt: new Date(), updatedAt: new Date(),
} satisfies PatientRow;

describe('valores do cadastro', () => {
  it('lê o FormData (checkbox marcado = "on") e devolve o que foi digitado', () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ nome: ' Ana ', dataNascimento: '1991-03-10', sexo: 'F', email: 'A@EX.COM', telefone: '11 91234 5678', whatsappAutorizado: 'on' })) f.set(k, v);
    expect(valoresDoFormulario(f)).toEqual({ nome: ' Ana ', dataNascimento: '1991-03-10', sexo: 'F', email: 'A@EX.COM', telefone: '11 91234 5678', whatsappAutorizado: true });
    expect(valoresDoFormulario(new FormData())).toEqual({ nome: '', dataNascimento: '', sexo: '', email: '', telefone: '', whatsappAutorizado: false });
  });
  it('preenche a edição a partir do paciente: telefone formatado; WhatsApp marcado só com opt-in sem opt-out', () => {
    expect(valoresDoPaciente(base)).toEqual({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: 'ana@ex.com', telefone: '(11) 91234-5678', whatsappAutorizado: true });
    expect(valoresDoPaciente({ ...base, whatsappOptoutEm: new Date() }).whatsappAutorizado).toBe(false);
    expect(valoresDoPaciente({ ...base, telefoneE164: null, dataNascimento: null, sexo: null })).toMatchObject({ telefone: '', dataNascimento: '', sexo: '' });
  });
  it('selo: Arquivado, Bloqueado (pedido de exclusão), Completar cadastro', () => {
    expect(seloDoPaciente(base)).toBeNull();
    expect(seloDoPaciente({ ...base, status: 'arquivado' })).toBe('Arquivado');
    expect(seloDoPaciente({ ...base, status: 'bloqueado' })).toBe('Bloqueado (pedido de exclusão)');
    expect(seloDoPaciente({ ...base, origem: 'agendamento_publico', dataNascimento: null })).toBe('Completar cadastro');
  });
});
```

Run: `pnpm test src/app/painel/pacientes/valores.test.ts`
Expected: FAIL — `Cannot find module './valores'`.

- [ ] **Step 2: Implementar os valores** — `src/app/painel/pacientes/valores.ts`

```ts
import type { PatientRow } from '@/db/schema';
import { formatarTelefone } from '@/modules/pacientes/telefone';

/** O que o formulário de cadastro manda e recebe de volta num erro (PF-N9: nada do que foi digitado se perde). */
export type ValoresPaciente = {
  nome: string;
  dataNascimento: string;
  sexo: string;
  email: string;
  telefone: string;
  whatsappAutorizado: boolean;
};

const campo = (f: FormData, k: string) => String(f.get(k) ?? '');

export function valoresDoFormulario(f: FormData): ValoresPaciente {
  return {
    nome: campo(f, 'nome'),
    dataNascimento: campo(f, 'dataNascimento'),
    sexo: campo(f, 'sexo'),
    email: campo(f, 'email'),
    telefone: campo(f, 'telefone'),
    whatsappAutorizado: f.get('whatsappAutorizado') === 'on',
  };
}

export function valoresDoPaciente(p: PatientRow): ValoresPaciente {
  return {
    nome: p.nome,
    dataNascimento: p.dataNascimento ?? '',
    sexo: p.sexo ?? '',
    email: p.email,
    telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : '',
    whatsappAutorizado: !!p.whatsappOptinEm && !p.whatsappOptoutEm,
  };
}

/** Selo do cabeçalho do prontuário (US-018 "Arquivado"). */
export function seloDoPaciente(p: Pick<PatientRow, 'status' | 'origem' | 'dataNascimento' | 'sexo'>): string | null {
  if (p.status === 'arquivado') return 'Arquivado';
  if (p.status === 'bloqueado') return 'Bloqueado (pedido de exclusão)';
  if (p.origem === 'agendamento_publico' && (!p.dataNascimento || !p.sexo)) return 'Completar cadastro';
  return null;
}
```

Run: `pnpm test src/app/painel/pacientes/valores.test.ts`
Expected: PASS.

- [ ] **Step 3: Server Actions e formulário** — `src/app/painel/pacientes/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { atualizarPaciente, criarPaciente, PacienteError, type ErrosPaciente } from '@/modules/pacientes/pacientes';
import { valoresDoFormulario, type ValoresPaciente } from './valores';

export type PacienteState = { erros?: ErrosPaciente; valores?: ValoresPaciente; ok?: boolean };

export async function criarPacienteAction(_prev: PacienteState, formData: FormData): Promise<PacienteState> {
  const { ctx, tenant } = await requireNutri('/painel/pacientes/novo');
  const valores = valoresDoFormulario(formData);
  let id: string;
  try {
    id = (await criarPaciente(ctx, tenant, valores)).id;
  } catch (e) {
    if (e instanceof PacienteError) return { erros: e.erros, valores };
    throw e;
  }
  redirect(`/painel/pacientes/${id}`);
}

export async function atualizarPacienteAction(patientId: string, _prev: PacienteState, formData: FormData): Promise<PacienteState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}`);
  const valores = valoresDoFormulario(formData);
  try {
    await atualizarPaciente(ctx, tenant, patientId, valores);
  } catch (e) {
    if (e instanceof PacienteError) return { erros: e.erros, valores };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return { ok: true };
}
```

`src/app/painel/pacientes/paciente-form.tsx`

```tsx
'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import type { PacienteState } from './actions';
import type { ValoresPaciente } from './valores';

type Props = {
  acao: (prev: PacienteState, formData: FormData) => Promise<PacienteState>;
  inicial: ValoresPaciente;
  botao: string;
  /** O paciente já ativou o acesso: o e-mail é o login dele. */
  emailBloqueado?: boolean;
  somenteLeitura?: boolean;
};

export function PacienteForm({ acao, inicial, botao, emailBloqueado, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<PacienteState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  const [telefone, setTelefone] = useState(v.telefone);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={somenteLeitura} className="space-y-4">
        <Campo id="nome" rotulo="Nome" required defaultValue={v.nome} erro={e.nome} autoComplete="off" />
        <Campo id="dataNascimento" rotulo="Data de nascimento" type="date" required defaultValue={v.dataNascimento} erro={e.dataNascimento} />
        <fieldset className="space-y-1" aria-describedby={e.sexo ? 'sexo-erro' : undefined}>
          <legend className="font-medium">Sexo biológico (usado nas fórmulas)</legend>
          {[
            ['F', 'Feminino'],
            ['M', 'Masculino'],
          ].map(([valor, rotulo]) => (
            <div key={valor} className="flex items-center gap-2">
              <input id={`sexo-${valor}`} name="sexo" type="radio" value={valor} defaultChecked={v.sexo === valor} aria-invalid={e.sexo ? true : undefined} />
              <label htmlFor={`sexo-${valor}`}>{rotulo}</label>
            </div>
          ))}
          {e.sexo && <p id="sexo-erro" role="alert" className="text-sm text-red-700">{e.sexo}</p>}
        </fieldset>
        <Campo
          id="email"
          rotulo="E-mail"
          type="email"
          required
          defaultValue={v.email}
          erro={e.email}
          readOnly={emailBloqueado}
          dica={emailBloqueado ? 'O paciente já ativou o acesso; o e-mail não pode ser alterado.' : undefined}
        />
        <Campo id="telefone" rotulo="Telefone (opcional)" type="tel" value={telefone} onChange={(ev) => setTelefone(ev.target.value)} erro={e.telefone} dica="Ex.: (11) 91234-5678" />
        <div className="flex items-start gap-2">
          <input
            id="whatsappAutorizado"
            name="whatsappAutorizado"
            type="checkbox"
            className="mt-1"
            defaultChecked={v.whatsappAutorizado}
            disabled={!telefone.trim()}
            aria-invalid={e.whatsappAutorizado ? true : undefined}
            aria-describedby={e.whatsappAutorizado ? 'whatsappAutorizado-erro' : undefined}
          />
          <label htmlFor="whatsappAutorizado">Paciente autorizou receber mensagens por WhatsApp</label>
        </div>
        {e.whatsappAutorizado && <p id="whatsappAutorizado-erro" role="alert" className="text-sm text-red-700">{e.whatsappAutorizado}</p>}
      </fieldset>
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      {state.ok && <p role="status">Cadastro salvo.</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{botao}</button>}
    </form>
  );
}
```

- [ ] **Step 4: Lista e novo paciente** — `src/app/painel/pacientes/page.tsx`

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { listarPacientes, type StatusPaciente } from '@/modules/pacientes/pacientes';
import { Cabecalho } from '../cabecalho';

export const dynamic = 'force-dynamic';

const SITUACOES: Record<StatusPaciente, string> = { ativo: 'Ativos', arquivado: 'Arquivados', bloqueado: 'Bloqueados' };
const texto = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default async function PacientesPage({ searchParams }: PageProps<'/painel/pacientes'>) {
  const { ctx, tenant } = await requireNutri('/painel/pacientes');
  const sp = await searchParams;
  const busca = texto(sp.busca);
  const status: StatusPaciente = Object.hasOwn(SITUACOES, texto(sp.status)) ? (texto(sp.status) as StatusPaciente) : 'ativo';
  const lista = await listarPacientes(ctx, { busca, status });
  const hoje = hojeNoFuso(tenant.fuso);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Pacientes</h1>
          <Link href="/painel/pacientes/novo" className="rounded bg-emerald-700 px-4 py-2 text-white">Novo paciente</Link>
        </div>
        <form role="search" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="busca" className="block font-medium">Buscar por nome ou e-mail</label>
            <input id="busca" name="busca" type="search" defaultValue={busca} className="rounded border p-2" />
          </div>
          <div className="space-y-1">
            <label htmlFor="status" className="block font-medium">Situação</label>
            <select id="status" name="status" defaultValue={status} className="rounded border p-2">
              {Object.entries(SITUACOES).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </div>
          <button className="rounded border px-4 py-2">Filtrar</button>
        </form>
        {lista.length === 0 ? (
          <p>Nenhum paciente encontrado.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Pacientes</caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Idade</th>
                <th scope="col">E-mail</th>
                <th scope="col">Acesso ao portal</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className="border-t">
                  <td><Link href={`/painel/pacientes/${p.id}`} className="underline">{p.nome}</Link></td>
                  <td>{p.dataNascimento ? `${idadeEm(p.dataNascimento, hoje)} anos` : 'Completar cadastro'}</td>
                  <td>{p.email}</td>
                  <td>{p.userId ? 'Ativo' : 'Pendente'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
```

`src/app/painel/pacientes/novo/page.tsx`

```tsx
import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from '../../cabecalho';
import { criarPacienteAction } from '../actions';
import { PacienteForm } from '../paciente-form';

export const dynamic = 'force-dynamic';

const VAZIO = { nome: '', dataNascimento: '', sexo: '', email: '', telefone: '', whatsappAutorizado: false };

export default async function NovoPacientePage() {
  const { tenant } = await requireNutri('/painel/pacientes/novo');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Novo paciente</h1>
        <PacienteForm acao={criarPacienteAction} inicial={VAZIO} botao="Cadastrar paciente" />
      </main>
    </>
  );
}
```

Em `src/app/painel/cabecalho.tsx`, no `<nav>`, acrescentar depois de "Início": `<Link href="/painel/pacientes">Pacientes</Link>`.

- [ ] **Step 5: Prontuário — carga única, layout, abas, resumo e histórico** — `src/app/painel/pacientes/[id]/prontuario.ts`

```ts
import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { buscarPaciente } from '@/modules/pacientes/pacientes';

/**
 * Uma leitura (auditada, US-007) do paciente por requisição, compartilhada entre o layout e a
 * página pelo `cache` do React — sem isso, cada abertura gravaria duas linhas "Visualizou".
 * Paciente de outro tenant ou id malformado → 404.
 */
export const carregarProntuario = cache(async (id: string) => {
  const acesso = await requireNutri(`/painel/pacientes/${id}`);
  const paciente = await buscarPaciente(acesso.ctx, id);
  if (!paciente) notFound();
  return { ...acesso, paciente };
});
```

`src/app/painel/pacientes/[id]/abas.tsx`

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Seções do prontuário. Cada tarefa acrescenta a sua ANTES de 'historico'. */
export const ABAS: readonly { seg: string; rotulo: string }[] = [
  { seg: '', rotulo: 'Resumo' },
  { seg: 'historico', rotulo: 'Histórico de acessos' },
];

export function Abas({ patientId }: { patientId: string }) {
  const atual = usePathname();
  const base = `/painel/pacientes/${patientId}`;
  return (
    <nav aria-label="Seções do prontuário">
      <ul className="flex flex-wrap gap-1 border-b">
        {ABAS.map((a) => {
          const href = a.seg ? `${base}/${a.seg}` : base;
          const ativa = a.seg ? atual === href || atual.startsWith(`${href}/`) : atual === base;
          return (
            <li key={a.seg || 'resumo'}>
              <Link href={href} aria-current={ativa ? 'page' : undefined} className={`block px-3 py-2 ${ativa ? 'border-b-2 border-emerald-700 font-semibold' : ''}`}>
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`src/app/painel/pacientes/[id]/layout.tsx`

```tsx
import Link from 'next/link';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { Cabecalho } from '../../cabecalho';
import { seloDoPaciente } from '../valores';
import { Abas } from './abas';
import { carregarProntuario } from './prontuario';

export default async function ProntuarioLayout({ children, params }: LayoutProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { tenant, paciente } = await carregarProntuario(id);
  const selo = seloDoPaciente(paciente);
  const partes = [
    paciente.dataNascimento ? `${idadeEm(paciente.dataNascimento, hojeNoFuso(tenant.fuso))} anos` : null,
    paciente.sexo === 'F' ? 'Feminino' : paciente.sexo === 'M' ? 'Masculino' : null,
    paciente.email,
  ].filter(Boolean);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <div className="space-y-4 p-6">
        <header className="space-y-1">
          <p className="text-sm"><Link href="/painel/pacientes" className="underline">Pacientes</Link></p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{paciente.nome}</h1>
            {selo && <span className="rounded bg-zinc-200 px-2 py-0.5 text-sm text-zinc-900">{selo}</span>}
          </div>
          <p className="text-sm text-zinc-700">{partes.join(' · ')}</p>
        </header>
        <Abas patientId={paciente.id} />
        {children}
      </div>
    </>
  );
}
```

`src/app/painel/pacientes/[id]/page.tsx`

```tsx
import { atualizarPacienteAction } from '../actions';
import { PacienteForm } from '../paciente-form';
import { valoresDoPaciente } from '../valores';
import { carregarProntuario } from './prontuario';

export const dynamic = 'force-dynamic';

export default async function ResumoPage({ params }: PageProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { paciente } = await carregarProntuario(id);
  const bloqueado = paciente.status === 'bloqueado';
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section aria-labelledby="cadastro-titulo" className="max-w-xl space-y-3">
        <h2 id="cadastro-titulo" className="text-lg font-semibold">Cadastro</h2>
        {bloqueado && <p role="status">Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.</p>}
        <PacienteForm
          acao={atualizarPacienteAction.bind(null, paciente.id)}
          inicial={valoresDoPaciente(paciente)}
          botao="Salvar cadastro"
          emailBloqueado={!!paciente.userId}
          somenteLeitura={bloqueado}
        />
      </section>
    </div>
  );
}
```

`src/app/painel/pacientes/[id]/historico/page.tsx`

```tsx
import { HistoricoAcessos } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

/** US-007: acessos a este paciente (inclusive às tabelas filhas), 50 por página, do mais recente. */
export default async function HistoricoPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/historico'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const pagina = Number(typeof sp.pagina === 'string' ? sp.pagina : '1') || 1;
  return <HistoricoAcessos ctx={ctx} patientId={paciente.id} pagina={pagina} fuso={tenant.fuso} baseHref={`/painel/pacientes/${paciente.id}/historico`} />;
}
```

Run: `pnpm typecheck` (roda `next typegen` antes e gera `PageProps`/`LayoutProps` das rotas novas)
Expected: sem erros.

- [ ] **Step 6: E2E do cadastro** — `e2e/pacientes.spec.ts`

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
// o seed do E2E não apaga pacientes: o sufixo no nome evita várias "Ana Souza" (strict mode) nas execuções locais seguintes
const ANA = { nome: `Ana Souza ${sufixo}`, email: `ana-${sufixo}@nutridebby.test`, senha: `Ana${sufixo}2026` };
let nutri: Page;
let prontuario = '';

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.5.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

async function preencherCadastro(page: Page, dados: { nome: string; email: string; nascimento: string }) {
  await page.getByLabel('Nome').fill(dados.nome);
  await page.getByLabel('Data de nascimento').fill(dados.nascimento);
  await page.getByLabel('Feminino').check();
  await page.getByLabel('E-mail').fill(dados.email);
  await page.getByLabel('Telefone (opcional)').fill('(11) 91234-5678');
  await page.getByLabel('Paciente autorizou receber mensagens por WhatsApp').check();
}

test('cadastra paciente adulto; menor de 18 e e-mail repetido são recusados (US-010, RN-17)', async () => {
  await nutri.goto('/painel/pacientes/novo');
  await preencherCadastro(nutri, { nome: ANA.nome, email: ANA.email, nascimento: '2010-01-01' });
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.locator('p[role="alert"]')).toHaveText('O sistema atende apenas pacientes a partir de 18 anos');
  await expect(nutri.getByLabel('Nome')).toHaveValue(ANA.nome); // PF-N9: nada do que foi digitado se perde

  await nutri.getByLabel('Data de nascimento').fill('1991-03-10');
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: ANA.nome })).toBeVisible();
  prontuario = new URL(nutri.url()).pathname;

  await nutri.goto('/painel/pacientes/novo');
  await preencherCadastro(nutri, { nome: 'Outra Ana', email: ANA.email.toUpperCase(), nascimento: '1990-01-01' });
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByText('Paciente já cadastrado com este e-mail')).toBeVisible();

  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(`ana souza ${sufixo}`)}`);
  await expect(nutri.getByRole('link', { name: ANA.nome })).toBeVisible();
});

test('abrir o prontuário fica registrado no "Histórico de acessos" (US-007)', async () => {
  await nutri.goto(prontuario);
  await nutri.getByRole('link', { name: 'Histórico de acessos' }).click();
  const primeira = nutri.getByRole('row').nth(1);
  await expect(primeira).toContainText('Visualizou');
  await expect(primeira).toContainText('Cadastro do paciente');
  await expect(primeira).toContainText('(nutricionista)');
});

test('paciente de outro tenant ou id inválido → 404', async () => {
  const r = await nutri.goto('/painel/pacientes/00000000-0000-4000-8000-000000000000');
  expect(r?.status()).toBe(404);
  expect((await nutri.request.get('/api/painel/pacientes/abc')).status()).toBe(404);
});
```

Run: `pnpm build && pnpm test:e2e e2e/pacientes.spec.ts` (Postgres e Mailpit do `docker-compose.dev.yml` no ar, `pnpm db:migrate` e `pnpm e2e:seed` antes)
Expected: PASS (3 testes).

- [ ] **Step 7: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/app/painel/pacientes src/app/painel/cabecalho.tsx e2e/pacientes.spec.ts
git commit -m "feat(pacientes): lista com busca, novo paciente, prontuário com abas e Histórico de acessos (P03-01b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Convite do paciente por e-mail — 7 dias, uso único, reenviar (P03-01c)

**Files:**
- Create: `src/modules/pacientes/convite-paciente.ts`, `src/modules/pacientes/convite-paciente.test.ts`, `drizzle/0018_convite_paciente.sql` (gerada)
- Modify: `src/db/schema/access.ts` (`invites`, `consents.tenant_id`), `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `src/modules/plataforma/convites.ts` (só `tipo = 'nutri'`), `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/modules/pacientes/pacientes.ts`, `src/app/painel/pacientes/valores.ts`, `src/app/painel/pacientes/valores.test.ts`, `src/app/painel/pacientes/actions.ts`, `src/app/painel/pacientes/[id]/page.tsx`, `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `carregarPacienteParaEscrita`, `PacienteBloqueadoError`, `PacienteNaoEncontradoError` (Tarefa 1); `criarPaciente`, `atualizarPaciente` (Tarefa 1); `enqueueEmail` (`@/email/queue`); `randomToken`, `sha256` (`@/lib/crypto`); `inspecionarConvite` (`@/modules/plataforma/convites`); `formatarDataHora` (`@/modules/plataforma/ui/historico-acessos`); `novoTenant`, `novoPaciente`, `emailsNaFila` (`test/pacientes.ts`).
- Produces:
  - Schema: `invites` com `tipo in ('nutri','paciente')`, `tenant_id`, `patient_id`, `user_id` nulo no convite de paciente; índice único parcial `invites_paciente_pendente_idx`. `consents.tenant_id` (nulo no DPA) com UNIQUE `(user_id, termo_versao, tenant_id) NULLS NOT DISTINCT`; `invites` e `consents` em `RLS_EXCEPTIONS`.
  - `EmailMessage` ganha `{ tipo: 'convite_paciente'; para; nome; nutri; link; contaExistente: boolean }`.
  - `@/modules/pacientes/convite-paciente`: `CONVITE_PACIENTE_VALIDADE_MS`, `MSG_CONVITE_PACIENTE`, `class ConvitePacienteError { campo? }`, `linkDoConvitePaciente(appUrl, token)`, `enviarConvitePaciente(tx, p, { appUrl, nutri, now }): Promise<{ expiraEm: Date }>`, `type SituacaoAcesso`, `situacaoDoAcesso(ctx, p, db?, now?)`, `reenviarConvitePaciente(ctx, tenant, patientId, deps?)`.
  - `src/app/painel/pacientes/valores.ts`: `textoDoAcesso(s: SituacaoAcesso, fuso: string): string`.
  - `src/app/painel/pacientes/actions.ts`: `reenviarConviteAction(patientId: string): Promise<void>`.

- [ ] **Step 1: `invites` para paciente** — em `src/db/schema/access.ts`, trocar os imports do topo e a tabela `invites` inteira por:

```ts
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { patients } from './pacientes';
import { tenants } from './platform';

/**
 * Convites de primeiro acesso. Só o SHA-256 do token é guardado.
 * - `nutri` (US-001, 72 h): aponta para o usuário já criado sem senha.
 * - `paciente` (US-010, 7 dias): aponta para o prontuário (tenant + paciente); a conta só nasce no aceite.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    patientId: uuid('patient_id'),
    tipo: text('tipo').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('invites_tipo_valido', sql`${t.tipo} in ('nutri', 'paciente')`),
    check(
      'invites_alvo',
      sql`(${t.tipo} = 'nutri' and ${t.userId} is not null and ${t.patientId} is null)
       or (${t.tipo} = 'paciente' and ${t.userId} is null and ${t.tenantId} is not null and ${t.patientId} is not null)`,
    ),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'invites_paciente_fk' }).onDelete('cascade'),
    index('invites_user_idx').on(t.userId),
    // T5-R3: só um convite pendente (não usado) por usuário — impede que um duplo clique em
    // "Reenviar convite" deixe dois convites válidos ao mesmo tempo. O mesmo vale por paciente.
    uniqueIndex('invites_user_pendente_idx').on(t.userId).where(sql`${t.usadoEm} is null`),
    uniqueIndex('invites_paciente_pendente_idx').on(t.patientId).where(sql`${t.usadoEm} is null`),
  ],
);
```

No mesmo arquivo, `consents` ganha o tenant do aceite: o paciente com dois vínculos aceita o termo uma vez para cada nutricionista (cada uma é controladora, RNF-08), e a prova (data, IP) precisa existir por vínculo. O DPA da nutricionista continua com `tenant_id` nulo (uma conta, um tenant); `NULLS NOT DISTINCT` mantém o "um aceite por versão" dele. Trocar a tabela `consents` inteira por:

```ts
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    /** Termo do paciente: o tenant do vínculo aceito. DPA da nutricionista: nulo. */
    tenantId: uuid('tenant_id').references(() => tenants.id),
    termoVersao: text('termo_versao').notNull(),
    aceitoEm: timestamp('aceito_em', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
  },
  (t) => [unique('consents_user_termo_tenant_unique').on(t.userId, t.termoVersao, t.tenantId).nullsNotDistinct()],
);
```

(O `unique` segue importado. `registrarAceiteDpa` não muda: o `onConflictDoNothing()` sem alvo vale para a UNIQUE nova. Conferir com `grep -rn consents_user_termo_unique src test` que nenhum código cita o nome antigo da constraint.)

Run: `pnpm db:generate --name convite_paciente`
Expected: `drizzle/0018_convite_paciente.sql` com `ALTER COLUMN "user_id" DROP NOT NULL`, `ADD COLUMN "tenant_id"`, `ADD COLUMN "patient_id"`, as FKs (`invites_tenant_id_tenants_id_fk`, `invites_paciente_fk` com `ON DELETE cascade`), o índice novo e os CHECKs (drop/add de `invites_tipo_valido`, add de `invites_alvo`); e, em `consents`, `ADD COLUMN "tenant_id"`, a FK para `tenants`, `DROP CONSTRAINT "consents_user_termo_unique"` e `ADD CONSTRAINT "consents_user_termo_tenant_unique" UNIQUE NULLS NOT DISTINCT("user_id","termo_versao","tenant_id")`. As linhas antigas (`nutri`, DPA com tenant nulo) passam nos CHECKs e na UNIQUE novos. `consents` é append-only (Plano 02, T6-R2c): a migration só acrescenta coluna e troca a constraint, não reescreve linhas.

Em `src/db/rls-guard.ts`, acrescentar ao `RLS_EXCEPTIONS`:

```ts
  consents:
    'prova de aceite (termo do paciente, DPA) gravada fora do contexto de tenant, append-only; tenant_id só identifica o vínculo aceito; acesso só por src/modules/plataforma/dpa.ts e src/modules/pacientes/convite-paciente.ts',
  invites:
    'lido pelo token antes de existir sessão (o paciente ainda nem tem conta); acesso só por src/modules/plataforma/convites.ts, src/modules/pacientes/convite-paciente.ts e src/modules/plataforma/contas.ts (validade do convite da nutricionista na lista do admin)',
```

Em `src/db/audit-guard.ts`, acrescentar ao `AUDIT_EXCEPTIONS`:

```ts
  invites: 'convite de acesso (hash do token, validade), não é dado de saúde',
```

Run: `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts`
Expected: PASS (`invites` passa a ter `tenant_id` e `patient_id`, `consents` passa a ter `tenant_id`, e as exceções justificam; `findStaleExceptions` confere que existem).

Run: `pnpm test src/modules/plataforma/dpa.test.ts src/modules/plataforma/primeiro-acesso.test.ts`
Expected: PASS (o reaceite da mesma versão do DPA continua gravando uma linha só: `NULLS NOT DISTINCT`).

- [ ] **Step 2: O convite da nutricionista ignora tokens de paciente** — em `src/modules/plataforma/convites.ts`:

1. Em `inspecionarConvite`, trocar o `select`/`where` por:

```ts
  const [c] = await q
    .select({ userId: user.id, expiraEm: invites.expiraEm, usadoEm: invites.usadoEm, email: user.email, nome: user.name })
    .from(invites)
    .innerJoin(user, eq(user.id, invites.userId))
    .where(and(eq(invites.tokenHash, sha256(token)), eq(invites.tipo, 'nutri')));
```

2. Em `aceitarConvite`, trocar o `UPDATE` que consome o convite e as duas linhas seguintes por:

```ts
    const [c] = await tx
      .update(invites)
      .set({ usadoEm: now })
      .where(and(eq(invites.tokenHash, sha256(input.token)), eq(invites.tipo, 'nutri'), isNull(invites.usadoEm), gt(invites.expiraEm, now)))
      .returning({ id: invites.id });
    if (!c) {
      const estado = await inspecionarConvite(tx, input.token, now);
      throw new ConviteError(estado.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO);
    }
    await tx.insert(account).values({ id: randomUUID(), userId: antes.userId, accountId: antes.userId, providerId: 'credential', password: hash });
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, antes.userId));
    await registrarAceiteDpa(tx, { userId: antes.userId, tenantId: u.tenantId, ip: input.ip, now });
```

(`antes.userId` é o mesmo usuário travado pelo `FOR UPDATE` acima; `invites.userId` agora pode ser nulo no tipo.)

Run: `pnpm test src/modules/plataforma`
Expected: PASS (nada muda para a nutricionista).

- [ ] **Step 3: Testes que falham do e-mail** — acrescentar ao `src/email/render.test.ts`:

```ts
describe('convite_paciente (US-010)', () => {
  const base = { tipo: 'convite_paciente' as const, para: 'ana@ex.com', nome: 'Ana Souza', nutri: 'Debby Silva', link: 'http://localhost:3000/convite/paciente/abc' };
  it('conta nova: criar a senha, 7 dias, uso único, link no texto e no botão', () => {
    const r = renderEmail({ ...base, contaExistente: false });
    expect(r.subject).toBe('Convite de Debby Silva no NutriDebby');
    for (const t of ['Olá, Ana Souza!', 'Debby Silva convidou você para acompanhar seu tratamento pelo NutriDebby.', 'O link vale por 7 dias e só pode ser usado uma vez.', base.link]) {
      expect(r.text).toContain(t);
    }
    expect(r.html).toContain('Criar minha senha');
    expect(r.html).toContain(`href="${base.link}"`);
  });
  it('quem já tem conta: "Entre com sua conta existente para ver os dados da nutricionista <A>"', () => {
    const r = renderEmail({ ...base, contaExistente: true });
    expect(r.text).toContain('Entre com sua conta existente para ver os dados da nutricionista Debby Silva.');
    expect(r.html).toContain('Entrar e aceitar o convite');
  });
});
```

(Se o arquivo ainda não importa `renderEmail`, acrescentar `import { renderEmail } from './templates';` no topo.)

Run: `pnpm test src/email/render.test.ts`
Expected: FAIL — erro de tipo/"Tipo de e-mail desconhecido: convite_paciente".

- [ ] **Step 4: Tipo e modelo do e-mail** — em `src/email/types.ts`, acrescentar ao union `EmailMessage`:

```ts
  | { tipo: 'convite_paciente'; para: string; nome: string; nutri: string; link: string; contaExistente: boolean }
```

Em `src/email/templates.tsx`, acrescentar o `case` antes do `default`:

```tsx
    case 'convite_paciente': {
      const subject = `Convite de ${msg.nutri} no NutriDebby`;
      const linhas = msg.contaExistente
        ? [
            `Olá, ${msg.nome}!`,
            `Entre com sua conta existente para ver os dados da nutricionista ${msg.nutri}.`,
            'Depois de entrar, confirme o termo de uso e privacidade para liberar o acompanhamento.',
          ]
        : [`Olá, ${msg.nome}!`, `${msg.nutri} convidou você para acompanhar seu tratamento pelo NutriDebby.`, 'Para começar, crie sua senha e leia o termo de uso e privacidade.'];
      const validade = 'O link vale por 7 dias e só pode ser usado uma vez. Se ele expirar, peça um novo à sua nutricionista.';
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.link}>{msg.contaExistente ? 'Entrar e aceitar o convite' : 'Criar minha senha'}</Botao>
            <P>{validade}</P>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link, validade].join('\n\n'),
      };
    }
```

Run: `pnpm test src/email/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Testes que falham do convite** — `src/modules/pacientes/convite-paciente.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { invites, user } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { sha256 } from '@/lib/crypto';
import { aceitarConvite, CONVITE_INVALIDO, inspecionarConvite } from '@/modules/plataforma/convites';
import { PacienteNaoEncontradoError } from './base';
import { ConvitePacienteError, MSG_CONVITE_PACIENTE, reenviarConvitePaciente, situacaoDoAcesso } from './convite-paciente';
import { atualizarPaciente, criarPaciente } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000' };
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
const dados = (email: string) => ({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email, telefone: '', whatsappAutorizado: false });
const tokenDe = (link: string) => link.split('/convite/paciente/')[1];
const pendentes = (patientId: string) => app.db.select().from(invites).where(and(eq(invites.patientId, patientId), isNull(invites.usadoEm)));

describe('convite do paciente (US-010)', () => {
  it('cadastrar enfileira o convite de 7 dias; no banco só o hash do token', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const email = `cv-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    const [msg] = await emailsNaFila('convite_paciente', email);
    expect(msg).toMatchObject({ nome: 'Ana Souza', nutri: 'Debby Silva', contaExistente: false });
    expect(msg.link).toMatch(/^http:\/\/localhost:3000\/convite\/paciente\/[A-Za-z0-9_-]{43}$/);
    const [c] = await pendentes(p.id);
    expect(c).toMatchObject({ tipo: 'paciente', tenantId: T.tenantId, userId: null, tokenHash: sha256(tokenDe(msg.link)) });
    expect(c.expiraEm.toISOString()).toBe('2026-10-08T15:00:00.000Z');
    expect(await situacaoDoAcesso(T.ctx, p, app.db, now)).toEqual({ estado: 'pendente', expiraEm: c.expiraEm });
    expect(await situacaoDoAcesso(T.ctx, p, app.db, new Date('2026-10-08T15:00:00Z'))).toEqual({ estado: 'expirado' });
  });

  it('quem já é paciente de outra nutricionista recebe o texto de conta existente', async () => {
    const T = await novoTenant(app.db);
    const email = `ja-${s()}@ex.com`;
    await app.db.insert(user).values({ id: randomUUID(), name: 'Ana', email, appRole: 'paciente' });
    await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    expect((await emailsNaFila('convite_paciente', email))[0].contaExistente).toBe(true);
  });

  it('três cadastros simultâneos do mesmo e-mail enfileiram um convite só (Review Focus 5)', async () => {
    const T = await novoTenant(app.db);
    const email = `sim-${s()}@ex.com`;
    await Promise.allSettled([1, 2, 3].map(() => criarPaciente(T.ctx, T.tenant, dados(email), deps)));
    expect(await emailsNaFila('convite_paciente', email)).toHaveLength(1);
  });

  it('reenviar troca o convite (o anterior deixa de valer) e renova os 7 dias', async () => {
    const T = await novoTenant(app.db);
    const email = `re-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    const [antigo] = await pendentes(p.id);
    const depois = new Date('2026-10-05T10:00:00Z');
    const r = await reenviarConvitePaciente(T.ctx, T.tenant, p.id, { ...deps, now: depois });
    expect(r.expiraEm.toISOString()).toBe('2026-10-12T10:00:00.000Z');
    const agora = await pendentes(p.id);
    expect(agora).toHaveLength(1);
    expect(agora[0].tokenHash).not.toBe(antigo.tokenHash);
    expect(await emailsNaFila('convite_paciente', email)).toHaveLength(2);
  });

  it('não reenvia para quem já ativou, para arquivado nem para paciente de outro tenant', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const uid = randomUUID();
    await app.db.insert(user).values({ id: uid, name: 'Ana', email: `at-${s()}@ex.com`, appRole: 'paciente' });
    const ativo = await novoPaciente(app.db, A.ctx, { userId: uid });
    await expect(reenviarConvitePaciente(A.ctx, A.tenant, ativo.id, deps)).rejects.toThrow(MSG_CONVITE_PACIENTE.jaAtivo);
    const arquivado = await novoPaciente(app.db, A.ctx, { status: 'arquivado' });
    await expect(reenviarConvitePaciente(A.ctx, A.tenant, arquivado.id, deps)).rejects.toBeInstanceOf(ConvitePacienteError);
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(reenviarConvitePaciente(A.ctx, A.tenant, deB.id, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await situacaoDoAcesso(A.ctx, ativo, app.db, now)).toEqual({ estado: 'ativo' });
  });

  it('corrigir o e-mail antes do aceite manda o convite para o e-mail novo', async () => {
    const T = await novoTenant(app.db);
    const errado = `errado-${s()}@ex.com`;
    const certo = `certo-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(errado), deps);
    await atualizarPaciente(T.ctx, T.tenant, p.id, dados(certo), deps);
    expect(await emailsNaFila('convite_paciente', certo)).toHaveLength(1);
    expect(await pendentes(p.id)).toHaveLength(1);
  });

  // Guarda de regressão: hoje o CHECK invites_alvo (user_id nulo no convite de paciente) + o innerJoin(user)
  // já barram o token; o filtro tipo = 'nutri' do Step 2 é a segunda camada. O que importa aqui é o efeito:
  // nem abre a tela, nem consome o convite do paciente pela rota da nutricionista.
  it('o token do paciente não abre nem consome o primeiro acesso da nutricionista (/convite/<token>)', async () => {
    const T = await novoTenant(app.db);
    const email = `nt-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    const [msg] = await emailsNaFila('convite_paciente', email);
    const token = tokenDe(msg.link);
    expect(await inspecionarConvite(app.db, token, now)).toEqual({ estado: 'invalido' });
    await expect(
      aceitarConvite({ token, senha: 'Senha-muito-boa-2026', confirmacao: 'Senha-muito-boa-2026', aceitouDpa: true, ip: null }, { db: app.db, now }),
    ).rejects.toThrow(CONVITE_INVALIDO);
    expect(await pendentes(p.id)).toHaveLength(1); // usado_em continua nulo
  });
});
```

Run: `pnpm test src/modules/pacientes/convite-paciente.test.ts`
Expected: FAIL — `Cannot find module './convite-paciente'`.

- [ ] **Step 6: Implementar o convite** — `src/modules/pacientes/convite-paciente.ts`

```ts
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { invites, user, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { randomToken, sha256 } from '@/lib/crypto';
import { carregarPacienteParaEscrita } from './base';

export const CONVITE_PACIENTE_VALIDADE_MS = 7 * 24 * 60 * 60 * 1000; // US-010: 7 dias

export const MSG_CONVITE_PACIENTE = {
  expirado: 'Convite expirado. Peça um novo à sua nutricionista.',
  invalido: 'Convite inválido ou já usado. Se você já criou sua senha, entre com seu e-mail e senha.',
  jaAtivo: 'O paciente já ativou o acesso ao portal.',
  inativo: 'Paciente arquivado ou bloqueado não recebe convite.',
  outraConta: 'Este convite foi enviado para outro e-mail. Saia desta conta e abra o link de novo.',
  contaDeEquipe: 'Este e-mail já é usado por outra conta. Peça à sua nutricionista para cadastrar outro e-mail.',
  indisponivel: 'Conta temporariamente indisponível',
} as const;

export class ConvitePacienteError extends Error {
  override name = 'ConvitePacienteError';
  constructor(
    message: string,
    /** Campo do formulário a marcar como inválido (a11y); ausente para erros do próprio convite. */
    readonly campo?: 'senha' | 'confirmacao' | 'termo',
  ) {
    super(message);
  }
}

export function linkDoConvitePaciente(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/convite/paciente/${token}`;
}

/**
 * Convite novo de 7 dias + e-mail na mesma transação. O pendente anterior do paciente some antes
 * (um por paciente: `invites_paciente_pendente_idx`). Quem já tem conta de paciente (outro tenant)
 * recebe o texto de "entre com sua conta existente". Chamar dentro de withTenant, com o paciente lido
 * (e travado, quando não é recém-criado).
 */
export async function enviarConvitePaciente(
  tx: Tx,
  p: Pick<PatientRow, 'id' | 'tenantId' | 'nome' | 'email'>,
  deps: { appUrl: string; nutri: string; now: Date },
): Promise<{ expiraEm: Date }> {
  const token = randomToken();
  const expiraEm = new Date(deps.now.getTime() + CONVITE_PACIENTE_VALIDADE_MS);
  await tx.delete(invites).where(and(eq(invites.patientId, p.id), isNull(invites.usadoEm)));
  await tx.insert(invites).values({ tipo: 'paciente', tenantId: p.tenantId, patientId: p.id, tokenHash: sha256(token), expiraEm, createdAt: deps.now });
  const [conta] = await tx.select({ papel: user.appRole }).from(user).where(eq(user.email, p.email));
  await enqueueEmail(
    {
      tipo: 'convite_paciente',
      para: p.email,
      nome: p.nome,
      nutri: deps.nutri,
      link: linkDoConvitePaciente(deps.appUrl, token),
      contaExistente: conta?.papel === 'paciente',
    },
    { tenantId: p.tenantId, tx },
  );
  return { expiraEm };
}

export type SituacaoAcesso = { estado: 'ativo' } | { estado: 'pendente'; expiraEm: Date } | { estado: 'expirado' } | { estado: 'sem_convite' };

/** Situação do acesso ao portal para o prontuário. `invites` não tem RLS: o filtro por tenant é explícito. */
export async function situacaoDoAcesso(
  ctx: TenantContext,
  p: Pick<PatientRow, 'id' | 'userId'>,
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<SituacaoAcesso> {
  if (p.userId) return { estado: 'ativo' };
  const [c] = await db
    .select({ expiraEm: invites.expiraEm })
    .from(invites)
    .where(and(eq(invites.tenantId, ctx.tenantId), eq(invites.patientId, p.id), eq(invites.tipo, 'paciente'), isNull(invites.usadoEm)))
    .orderBy(desc(invites.createdAt))
    .limit(1);
  if (!c) return { estado: 'sem_convite' };
  return c.expiraEm.getTime() <= now.getTime() ? { estado: 'expirado' } : { estado: 'pendente', expiraEm: c.expiraEm };
}

/** "Reenviar convite": o paciente fica travado (FOR UPDATE), então dois cliques seguidos não deixam dois convites. */
export async function reenviarConvitePaciente(
  ctx: TenantContext,
  tenant: { nomeExibicao: string },
  patientId: string,
  deps: { db?: Db; now?: Date; appUrl?: string } = {},
): Promise<{ expiraEm: Date }> {
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.userId) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.jaAtivo);
      if (p.status !== 'ativo') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.inativo);
      return enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now: deps.now ?? new Date() });
    },
    deps.db ?? getDb(),
  );
}
```

Em `src/modules/pacientes/pacientes.ts`:

1. Imports: acrescentar `import { getEnv } from '@/env';` e `import { enviarConvitePaciente } from './convite-paciente';`.
2. Em `criarPaciente`, logo depois do `insert … returning()` e antes do `return p;`:

```ts
        // US-010: convite de 7 dias por e-mail na mesma transação (paciente criado ⇔ convite na fila)
        await enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now });
```

3. Em `atualizarPaciente`, logo depois do `update … returning()` e antes do `return p;`:

```ts
        // E-mail corrigido antes do aceite: o convite pendente ia para o endereço errado
        if (!p.userId && p.status === 'ativo' && atual.email !== p.email) {
          await enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now });
        }
```

Run: `pnpm test src/modules/pacientes`
Expected: PASS (inclusive os testes da Tarefa 1).

- [ ] **Step 7: "Acesso ao portal" no prontuário** — acrescentar ao `src/app/painel/pacientes/valores.test.ts`:

```ts
import { textoDoAcesso } from './valores';

describe('textoDoAcesso', () => {
  it('descreve cada situação do convite, com a validade no fuso do tenant', () => {
    expect(textoDoAcesso({ estado: 'ativo' }, 'America/Sao_Paulo')).toBe('Ativo: o paciente já criou a senha.');
    expect(textoDoAcesso({ estado: 'pendente', expiraEm: new Date('2026-10-08T15:00:00Z') }, 'America/Sao_Paulo')).toBe(
      'Convite enviado por e-mail. Vale até 08/10/2026, 12:00.',
    );
    expect(textoDoAcesso({ estado: 'expirado' }, 'America/Sao_Paulo')).toBe('Convite expirado. Reenvie para o paciente conseguir entrar.');
    expect(textoDoAcesso({ estado: 'sem_convite' }, 'America/Sao_Paulo')).toBe('Nenhum convite pendente.');
  });
});
```

Em `src/app/painel/pacientes/valores.ts`, acrescentar:

```ts
import type { SituacaoAcesso } from '@/modules/pacientes/convite-paciente';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';

export function textoDoAcesso(s: SituacaoAcesso, fuso: string): string {
  switch (s.estado) {
    case 'ativo':
      return 'Ativo: o paciente já criou a senha.';
    case 'pendente':
      return `Convite enviado por e-mail. Vale até ${formatarDataHora(s.expiraEm, fuso)}.`;
    case 'expirado':
      return 'Convite expirado. Reenvie para o paciente conseguir entrar.';
    case 'sem_convite':
      return 'Nenhum convite pendente.';
  }
}
```

Em `src/app/painel/pacientes/actions.ts`, acrescentar (imports junto dos existentes):

```ts
import { ConvitePacienteError, reenviarConvitePaciente } from '@/modules/pacientes/convite-paciente';

/** O botão só aparece quando reenviar vale; uma recusa aqui é corrida (outra aba) e a página já mostra a situação nova. */
export async function reenviarConviteAction(patientId: string): Promise<void> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}`);
  try {
    await reenviarConvitePaciente(ctx, tenant, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof ConvitePacienteError) && !(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`);
}
```

Em `src/app/painel/pacientes/[id]/page.tsx`: importar `situacaoDoAcesso` (`@/modules/pacientes/convite-paciente`), `reenviarConviteAction` (`../actions`) e `textoDoAcesso` (`../valores`); trocar `const { paciente } = await carregarProntuario(id);` por `const { ctx, tenant, paciente } = await carregarProntuario(id);`, calcular `const acesso = await situacaoDoAcesso(ctx, paciente);` e acrescentar, depois da `<section>` do cadastro, dentro do grid:

```tsx
      <section aria-labelledby="acesso-titulo" className="space-y-2">
        <h2 id="acesso-titulo" className="text-lg font-semibold">Acesso ao portal</h2>
        <p>{textoDoAcesso(acesso, tenant.fuso)}</p>
        {acesso.estado !== 'ativo' && paciente.status === 'ativo' && (
          <form action={reenviarConviteAction.bind(null, paciente.id)}>
            <button className="rounded border px-4 py-2">Reenviar convite</button>
          </form>
        )}
      </section>
```

- [ ] **Step 8: CLAUDE.md** — na regra 1, na lista de quem acessa a tabela `user` fora de `withTenant`, acrescentar depois de `src/modules/plataforma/monitoramento.ts (…)`: `, por src/modules/pacientes/convite-paciente.ts (convite e aceite do paciente, US-010/US-011: lê o papel da conta pelo e-mail, cria a conta do paciente e o aceite do termo), por test/pacientes.ts (helper de testes que cria a nutricionista do tenant)`; e no fim da regra: `A tabela invites (convites de nutricionista e de paciente) é exceção de RLS: só src/modules/plataforma/convites.ts, src/modules/pacientes/convite-paciente.ts e src/modules/plataforma/contas.ts (validade do convite da nutricionista na lista do admin) a acessam, sempre filtrando por tipo ou por user_id (e por tenant, no de paciente).`; e trocar `As tabelas sem \`tenant_id\` do M1 (\`tenants\`, \`invites\`, \`consents\`, \`backup_runs\`) seguem a mesma regra.` por `As tabelas do M1 fora da RLS (\`tenants\`, \`backup_runs\` e, com \`tenant_id\` mas em \`RLS_EXCEPTIONS\`, \`invites\` e \`consents\`) seguem a mesma regra.`

- [ ] **Step 9: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/db/schema/access.ts drizzle/0018_convite_paciente.sql drizzle/meta src/db/rls-guard.ts src/db/audit-guard.ts \
  src/modules/plataforma/convites.ts src/email src/modules/pacientes src/app/painel/pacientes CLAUDE.md
git commit -m "feat(pacientes): convite do paciente por e-mail (7 dias, uso único, só hash), reenviar e situação do acesso (P03-01c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Paciente aceita o convite — senha, termo versionado e opt-in de WhatsApp (P03-02)

**Files:**
- Create: `src/modules/pacientes/termo-paciente.ts`, `src/app/convite/paciente/[token]/page.tsx`, `src/app/convite/paciente/[token]/form.tsx`, `src/app/convite/paciente/[token]/actions.ts`
- Modify: `src/modules/pacientes/convite-paciente.ts`, `src/modules/pacientes/convite-paciente.test.ts`, `e2e/pacientes.spec.ts`

**Interfaces:**
- Consumes: `invites`, `patients`, `user`, `account`, `consents` (schema); `withTenant`; `buscarTenant` (`@/modules/plataforma/tenant-status`); `validatePasswordPolicy` (`@/lib/password-policy`); `commonPasswords`, `hashPassword` (`@/lib/password.server`); `uniqueViolation`; `normalizeEmail`; `requestIp`; `getAuth`; `requireUser` (`@/lib/session`); `SUSPENDED_PATH` (`@/lib/session-rules`); `ConvitePacienteError`, `MSG_CONVITE_PACIENTE` (Tarefa 3); `entrar` (`test/sessao.ts`); `esperarEmail`, `primeiroLink` (`e2e/mailpit.ts`).
- Produces:
  - `@/modules/pacientes/termo-paciente`: `TERMO_PACIENTE_VERSAO = '0.1-provisorio'`, `TERMO_PACIENTE` (chave em `consents.termo_versao`), `TERMO_PACIENTE_TITULO`, `TERMO_PACIENTE_ROTULO`, `TERMO_PACIENTE_PARAGRAFOS`, `MSG_TERMO_NAO_ACEITO`.
  - `@/modules/pacientes/convite-paciente`: `type EstadoConvitePaciente`, `inspecionarConvitePaciente(db, token, now?)`, `aceitarConvitePaciente(input, deps?): Promise<{ email: string }>` (conta nova), `vincularContaExistente(input, deps?): Promise<void>` (quem já é paciente de outro tenant).
  - Página `/convite/paciente/[token]` e as actions `aceitarConvitePacienteAction`, `vincularContaAction`.

- [ ] **Step 1: Termo provisório** — `src/modules/pacientes/termo-paciente.ts`

```ts
/**
 * US-011 / RNF-08. Texto PROVISÓRIO (P-02, E-09): o P08-06 publica o texto do advogado com versão
 * nova, e o Plano 06 exige o novo aceite no login. Aceite gravado em `consents` (uma linha por versão).
 */
export const TERMO_PACIENTE_VERSAO = '0.1-provisorio';
export const TERMO_PACIENTE = `termo-paciente-${TERMO_PACIENTE_VERSAO}`;
export const TERMO_PACIENTE_TITULO = 'Termo de Uso e Privacidade';
export const TERMO_PACIENTE_ROTULO = `Li e aceito o Termo de Uso e Privacidade (versão ${TERMO_PACIENTE_VERSAO})`;
export const MSG_TERMO_NAO_ACEITO = 'Para continuar, aceite o Termo de Uso e Privacidade.';

export const TERMO_PACIENTE_PARAGRAFOS: readonly string[] = [
  'Versão provisória, a ser substituída pelo texto revisado por advogado antes do uso com pacientes reais.',
  'Quem cuida dos seus dados é a sua nutricionista (controladora). O NutriDebby é a plataforma que ela usa para guardar o prontuário e falar com você (operadora).',
  'Seus dados de saúde (anamnese, medidas, exames, plano alimentar e diário) são usados só no seu acompanhamento nutricional. Cada acesso ao seu prontuário fica registrado.',
  'Você pode pedir a qualquer momento uma cópia dos seus dados ou a exclusão deles. Por obrigação legal, o prontuário clínico fica guardado de forma bloqueada pelo prazo exigido e depois é anonimizado.',
  'Mensagens por WhatsApp só são enviadas se você autorizar, e você pode desistir quando quiser. Os lembretes continuam por e-mail.',
];
```

- [ ] **Step 2: Testes que falham do aceite** — acrescentar ao `src/modules/pacientes/convite-paciente.test.ts` (imports novos no topo, junto dos existentes):

```ts
import { account, auditLog, consents, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { createAuth } from '@/lib/auth';
import { verifyPassword } from '@/lib/password.server';
import { entrar } from '../../../test/sessao';
import { aceitarConvitePaciente, inspecionarConvitePaciente, vincularContaExistente } from './convite-paciente';
import { buscarPaciente, listarPacientes } from './pacientes';
import { MSG_TERMO_NAO_ACEITO, TERMO_PACIENTE } from './termo-paciente';

const SENHA = 'Paciente2026segura';
const auth = createAuth(app.db, { verificarTurnstile: async () => 'ok' });

/** Paciente cadastrado pela nutricionista (com WhatsApp autorizado) + token do convite em claro. */
async function convidado(extra: Record<string, unknown> = {}) {
  const T = await novoTenant(app.db, 'Debby Silva');
  const email = `ac-${s()}@ex.com`;
  const p = await criarPaciente(T.ctx, T.tenant, { ...dados(email), telefone: '(11) 91234-5678', whatsappAutorizado: true, ...extra }, deps);
  const [msg] = await emailsNaFila('convite_paciente', email);
  return { T, p, email, token: tokenDe(msg.link) };
}
const aceite = (token: string, extra: Partial<Parameters<typeof aceitarConvitePaciente>[0]> = {}) =>
  aceitarConvitePaciente({ token, senha: SENHA, confirmacao: SENHA, aceitouTermo: true, whatsapp: true, ip: '203.0.113.30', ...extra }, { db: app.db, now });
const lerPaciente = async (T: { tenantId: string; ctx: Parameters<typeof withTenant>[0] }, id: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, id)), app.db))[0];

describe('aceite do convite — conta nova (US-011)', () => {
  it('cria a conta de paciente, grava a senha, o termo (versão, data, IP), liga o prontuário e o opt-in do próprio paciente', async () => {
    const c = await convidado();
    expect(await inspecionarConvitePaciente(app.db, c.token, now)).toMatchObject({ estado: 'valido', conta: 'nenhuma', nutri: 'Debby Silva', temTelefone: true, whatsappMarcado: true });
    expect(await aceite(c.token)).toEqual({ email: c.email });
    const [u] = await app.db.select().from(user).where(eq(user.email, c.email));
    expect(u).toMatchObject({ appRole: 'paciente', tenantId: null, emailVerified: true, name: 'Ana Souza' });
    const [acc] = await app.db.select().from(account).where(eq(account.userId, u.id));
    expect(await verifyPassword(acc.password!, SENHA)).toBe(true);
    const [cons] = await app.db.select().from(consents).where(eq(consents.userId, u.id));
    expect(cons).toMatchObject({ termoVersao: TERMO_PACIENTE, tenantId: c.T.tenantId, ip: '203.0.113.30' });
    const p = await lerPaciente(c.T, c.p.id);
    expect(p).toMatchObject({ userId: u.id, whatsappOptinOrigem: 'paciente', whatsappOptoutEm: null });
    const log = await withTenant(c.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidadeId, c.p.id), eq(auditLog.acao, 'alterar'))).orderBy(auditLog.criadoEm), app.db);
    expect(log.at(-1)).toMatchObject({ actorUserId: u.id, ip: '203.0.113.30' });
    await expect(entrar(auth, c.email, SENHA)).resolves.toMatch(/^nd\.session_token=/);
    expect(await inspecionarConvitePaciente(app.db, c.token, now)).toEqual({ estado: 'invalido' });
  });

  it('sem o termo, com senha fraca ou senhas diferentes: nada é gravado e o convite continua valendo', async () => {
    const c = await convidado();
    await expect(aceite(c.token, { aceitouTermo: false })).rejects.toThrow(MSG_TERMO_NAO_ACEITO);
    await expect(aceite(c.token, { senha: 'curta1', confirmacao: 'curta1' })).rejects.toThrow('A senha precisa ter pelo menos 10 caracteres.');
    await expect(aceite(c.token, { confirmacao: 'Outra2026senha' })).rejects.toThrow('As senhas não conferem.');
    expect(await app.db.select().from(user).where(eq(user.email, c.email))).toEqual([]);
    await expect(aceite(c.token)).resolves.toEqual({ email: c.email });
  });

  it('desmarcar o WhatsApp que a nutricionista tinha autorizado grava o opt-out', async () => {
    const c = await convidado();
    await aceite(c.token, { whatsapp: false });
    const p = await lerPaciente(c.T, c.p.id);
    expect(p.whatsappOptinOrigem).toBe('nutri');
    expect(p.whatsappOptoutEm?.toISOString()).toBe(now.toISOString());
  });

  it('duplo clique em "Continuar": uma conta só, os outros envios veem convite inválido (Review Focus 3)', async () => {
    const c = await convidado();
    const r = await Promise.allSettled([aceite(c.token), aceite(c.token), aceite(c.token)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const f of r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect((f.reason as Error).message).toBe(MSG_CONVITE_PACIENTE.invalido);
    }
    expect(await app.db.select().from(user).where(eq(user.email, c.email))).toHaveLength(1);
  });

  it('expirado, arquivado depois do convite, ou nutricionista suspensa: recusado', async () => {
    const c = await convidado();
    await expect(aceitarConvitePaciente({ token: c.token, senha: SENHA, confirmacao: SENHA, aceitouTermo: true, whatsapp: false, ip: null }, { db: app.db, now: new Date('2026-10-08T15:00:01Z') })).rejects.toThrow(
      MSG_CONVITE_PACIENTE.expirado,
    );
    const arq = await convidado();
    await withTenant(arq.T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, arq.p.id)), app.db);
    await expect(aceite(arq.token)).rejects.toThrow(MSG_CONVITE_PACIENTE.invalido);
    const sus = await convidado();
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, sus.T.tenantId));
    await expect(aceite(sus.token)).rejects.toThrow(MSG_CONVITE_PACIENTE.indisponivel);
  });
});

describe('aceite do convite — quem já tem conta (US-010 "E-mail já usado por paciente de outra nutricionista")', () => {
  it('a mesma conta passa a ter o vínculo com a segunda nutricionista; nenhum dado do tenant B aparece no A', async () => {
    const primeiro = await convidado();
    await aceite(primeiro.token);
    const [u] = await app.db.select().from(user).where(eq(user.email, primeiro.email));
    const B = await novoTenant(app.db, 'Outra Nutri');
    const pB = await criarPaciente(B.ctx, B.tenant, { ...dados(primeiro.email), nome: 'Ana S.' }, deps);
    const [msg] = (await emailsNaFila('convite_paciente', primeiro.email)).filter((m) => m.nutri === 'Outra Nutri');
    expect(msg.contaExistente).toBe(true);
    const tokenB = tokenDe(msg.link);
    expect(await inspecionarConvitePaciente(app.db, tokenB, now)).toMatchObject({ estado: 'valido', conta: 'paciente' });
    await vincularContaExistente({ token: tokenB, userId: u.id, aceitouTermo: true, whatsapp: false, ip: '203.0.113.31' }, { db: app.db, now });
    expect((await lerPaciente(B, pB.id)).userId).toBe(u.id);
    // mesma versão do termo, mas uma prova de aceite por nutricionista (controladora), com data e IP de cada vínculo
    const aceites = await app.db.select().from(consents).where(eq(consents.userId, u.id));
    expect(aceites.map((c) => [c.tenantId, c.ip]).sort()).toEqual([[B.tenantId, '203.0.113.31'], [primeiro.T.tenantId, '203.0.113.30']].sort());
    // a nutricionista A não enxerga o prontuário nem o vínculo de B (US-006)
    expect(await buscarPaciente(primeiro.T.ctx, pB.id, app.db)).toBeNull();
    expect((await listarPacientes(primeiro.T.ctx, {}, app.db)).map((x) => x.nome)).not.toContain('Ana S.');
    expect((await lerPaciente(primeiro.T, primeiro.p.id)).userId).toBe(u.id); // o vínculo de A segue o mesmo
  });

  it('conta de outro e-mail ou e-mail que é de nutricionista: mensagem clara e nada vinculado (Review Focus 3)', async () => {
    const c = await convidado();
    const outro = randomUUID();
    await app.db.insert(user).values({ id: outro, name: 'Outra', email: `outra-${s()}@ex.com`, appRole: 'paciente' });
    await expect(vincularContaExistente({ token: c.token, userId: outro, aceitouTermo: true, whatsapp: false, ip: null }, { db: app.db, now })).rejects.toThrow(
      MSG_CONVITE_PACIENTE.outraConta,
    );
    expect((await lerPaciente(c.T, c.p.id)).userId).toBeNull();

    const T = await novoTenant(app.db);
    const emailDaNutri = `nutri-${s()}@ex.com`;
    await app.db.insert(user).values({ id: randomUUID(), name: 'Nutri', email: emailDaNutri, appRole: 'nutri', tenantId: T.tenantId });
    await criarPaciente(T.ctx, T.tenant, dados(emailDaNutri), deps);
    const token = tokenDe((await emailsNaFila('convite_paciente', emailDaNutri))[0].link);
    expect(await inspecionarConvitePaciente(app.db, token, now)).toMatchObject({ estado: 'valido', conta: 'equipe' });
    await expect(aceite(token)).rejects.toThrow(MSG_CONVITE_PACIENTE.contaDeEquipe);
  });
});
```

Run: `pnpm test src/modules/pacientes/convite-paciente.test.ts`
Expected: FAIL — `aceitarConvitePaciente is not a function` (e os outros exports novos).

- [ ] **Step 3: Implementar o aceite** — acrescentar ao `src/modules/pacientes/convite-paciente.ts` (imports novos no topo):

```ts
import { randomUUID } from 'node:crypto';
import { gt } from 'drizzle-orm';
import { uniqueViolation } from '@/db/errors';
import { account, consents, patients } from '@/db/schema';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { commonPasswords, hashPassword } from '@/lib/password.server';
import { normalizeEmail } from '@/lib/text';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { MSG_TERMO_NAO_ACEITO, TERMO_PACIENTE } from './termo-paciente';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type EstadoConvitePaciente =
  | {
      estado: 'valido';
      tenantId: string;
      patientId: string;
      nome: string;
      email: string;
      nutri: string;
      tenantSuspenso: boolean;
      temTelefone: boolean;
      /** Opt-in vigente (da nutricionista ou do paciente): a caixa do WhatsApp vem marcada. */
      whatsappMarcado: boolean;
      /** Conta com o e-mail do convite: nenhuma, de paciente (outro tenant) ou da equipe (nutri/admin). */
      conta: 'nenhuma' | 'paciente' | 'equipe';
    }
  | { estado: 'expirado' }
  | { estado: 'invalido' };

/** Lê o convite pelo token (sem sessão). O prontuário é lido no contexto do próprio paciente (RLS). */
export async function inspecionarConvitePaciente(db: Db, token: string, now: Date = new Date()): Promise<EstadoConvitePaciente> {
  if (!TOKEN.test(token)) return { estado: 'invalido' };
  const [c] = await db
    .select({ tenantId: invites.tenantId, patientId: invites.patientId, expiraEm: invites.expiraEm, usadoEm: invites.usadoEm })
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), eq(invites.tipo, 'paciente')));
  if (!c?.tenantId || !c.patientId || c.usadoEm) return { estado: 'invalido' };
  if (c.expiraEm.getTime() <= now.getTime()) return { estado: 'expirado' };
  const { tenantId, patientId } = c;
  const tenant = await buscarTenant(db, tenantId);
  const [p] = await withTenant({ tenantId, role: 'paciente', patientId }, (tx) => tx.select().from(patients).where(eq(patients.id, patientId)), db);
  if (!tenant || !p || p.status !== 'ativo' || p.userId) return { estado: 'invalido' };
  const [u] = await db.select({ papel: user.appRole }).from(user).where(eq(user.email, p.email));
  return {
    estado: 'valido',
    tenantId,
    patientId,
    nome: p.nome,
    email: p.email,
    nutri: tenant.nomeExibicao,
    tenantSuspenso: tenant.status === 'suspensa',
    temTelefone: !!p.telefoneE164,
    whatsappMarcado: !!p.whatsappOptinEm && !p.whatsappOptoutEm,
    conta: !u ? 'nenhuma' : u.papel === 'paciente' ? 'paciente' : 'equipe',
  };
}

type Valido = Extract<EstadoConvitePaciente, { estado: 'valido' }>;

async function prepararAceite(db: Db, token: string, aceitouTermo: boolean, now: Date): Promise<Valido> {
  if (!aceitouTermo) throw new ConvitePacienteError(MSG_TERMO_NAO_ACEITO, 'termo');
  const e = await inspecionarConvitePaciente(db, token, now);
  if (e.estado === 'expirado') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.expirado);
  if (e.estado !== 'valido') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
  if (e.tenantSuspenso) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.indisponivel); // RN-15
  if (e.conta === 'equipe') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.contaDeEquipe); // §3: um papel por login
  return e;
}

/** UPDATE … WHERE usado_em IS NULL trava a linha: o segundo envio simultâneo vê 0 linhas. */
async function consumirConvite(tx: Tx, token: string, now: Date): Promise<void> {
  const [c] = await tx
    .update(invites)
    .set({ usadoEm: now })
    .where(and(eq(invites.tokenHash, sha256(token)), eq(invites.tipo, 'paciente'), isNull(invites.usadoEm), gt(invites.expiraEm, now)))
    .returning({ id: invites.id });
  if (!c) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
}

async function travarPacienteDoConvite(tx: Tx, patientId: string): Promise<PatientRow> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo' || p.userId) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
  return p;
}

/** US-011: marcar = opt-in do próprio paciente; desmarcar o que estava autorizado = opt-out (INT-01). */
function escolhaWhatsapp(quer: boolean, p: PatientRow, now: Date) {
  if (!p.telefoneE164) return {};
  if (quer) return { whatsappOptinEm: now, whatsappOptinOrigem: 'paciente', whatsappOptoutEm: null };
  return p.whatsappOptinEm && !p.whatsappOptoutEm ? { whatsappOptoutEm: now } : {};
}

/** Uma prova de aceite por nutricionista (cada uma é controladora dos dados, RNF-08): (usuário, versão, tenant). */
async function registrarAceiteTermo(tx: Tx, userId: string, tenantId: string, ip: string | null, now: Date): Promise<void> {
  await tx.insert(consents).values({ userId, tenantId, termoVersao: TERMO_PACIENTE, aceitoEm: now, ip }).onConflictDoNothing();
}

/**
 * Conta nova (US-011 "Aceite do convite"): consome o convite, cria o login de paciente (sem tenant:
 * o vínculo é o prontuário), grava a senha, o termo e a escolha do WhatsApp — numa transação com o
 * ator = o próprio paciente (auditoria da alteração em `patients`).
 */
export async function aceitarConvitePaciente(
  input: { token: string; senha: string; confirmacao: string; aceitouTermo: boolean; whatsapp: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ email: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!input.aceitouTermo) throw new ConvitePacienteError(MSG_TERMO_NAO_ACEITO, 'termo');
  const politica = validatePasswordPolicy(input.senha, commonPasswords());
  if (politica) throw new ConvitePacienteError(politica, 'senha');
  if (input.senha !== input.confirmacao) throw new ConvitePacienteError('As senhas não conferem.', 'confirmacao');
  // T6-R2a do Plano 02: checagem barata antes do argon2 (~19 MB por chamada, VPS compartilhada)
  const e = await prepararAceite(db, input.token, true, now);
  if (e.conta !== 'nenhuma') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido); // conta existente: vincularContaExistente
  const hash = await hashPassword(input.senha);
  const userId = randomUUID();
  try {
    return await withTenant(
      { tenantId: e.tenantId, role: 'paciente', patientId: e.patientId, actorUserId: userId, ip: input.ip },
      async (tx) => {
        // T6-R1 do Plano 02: sempre paciente → convite, a mesma ordem de reenviarConvitePaciente e de
        // atualizarPaciente (troca de e-mail). A ordem invertida permitia deadlock (40P01) entre elas.
        const p = await travarPacienteDoConvite(tx, e.patientId);
        await consumirConvite(tx, input.token, now);
        await tx.insert(user).values({ id: userId, name: p.nome, email: p.email, emailVerified: true, appRole: 'paciente', createdAt: now, updatedAt: now });
        await tx.insert(account).values({ id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: hash });
        await registrarAceiteTermo(tx, userId, e.tenantId, input.ip, now);
        await tx.update(patients).set({ userId, ...escolhaWhatsapp(input.whatsapp, p, now), updatedAt: now }).where(eq(patients.id, p.id));
        return { email: p.email };
      },
      db,
    );
  } catch (err) {
    // Conta criada com o mesmo e-mail entre a checagem e o INSERT (outra aba, outro convite)
    if (uniqueViolation(err) === 'user_email_unique') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
    throw err;
  }
}

/**
 * Quem já é paciente de outra nutricionista (US-010): entra com a conta existente e só confirma o termo
 * e o WhatsApp. O e-mail da conta precisa ser o do convite — outro login não "adota" o prontuário.
 */
export async function vincularContaExistente(
  input: { token: string; userId: string; aceitouTermo: boolean; whatsapp: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const e = await prepararAceite(db, input.token, input.aceitouTermo, now);
  const [u] = await db.select({ email: user.email, papel: user.appRole }).from(user).where(eq(user.id, input.userId));
  if (!u || u.papel !== 'paciente' || normalizeEmail(u.email) !== normalizeEmail(e.email)) {
    throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.outraConta);
  }
  await withTenant(
    { tenantId: e.tenantId, role: 'paciente', patientId: e.patientId, actorUserId: input.userId, ip: input.ip },
    async (tx) => {
      const p = await travarPacienteDoConvite(tx, e.patientId); // paciente → convite (T6-R1)
      await consumirConvite(tx, input.token, now);
      await registrarAceiteTermo(tx, input.userId, e.tenantId, input.ip, now);
      await tx.update(patients).set({ userId: input.userId, ...escolhaWhatsapp(input.whatsapp, p, now), updatedAt: now }).where(eq(patients.id, p.id));
    },
    db,
  );
}
```

(Juntar o `gt` ao import de `drizzle-orm` já existente no arquivo, e `account`, `consents`, `patients` ao de `@/db/schema`.)

Run: `pnpm test src/modules/pacientes/convite-paciente.test.ts`
Expected: PASS.

- [ ] **Step 4: Página do convite** — `src/app/convite/paciente/[token]/actions.ts`

```ts
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { requireUser } from '@/lib/session';
import { aceitarConvitePaciente, ConvitePacienteError, vincularContaExistente } from '@/modules/pacientes/convite-paciente';

export type AceitePacienteState = { erro?: string; campo?: 'senha' | 'confirmacao' | 'termo' };

export async function aceitarConvitePacienteAction(token: string, _prev: AceitePacienteState, formData: FormData): Promise<AceitePacienteState> {
  const senha = String(formData.get('senha') ?? '');
  let email: string;
  try {
    ({ email } = await aceitarConvitePaciente({
      token,
      senha,
      confirmacao: String(formData.get('confirmacao') ?? ''),
      aceitouTermo: formData.get('termo') === 'on',
      whatsapp: formData.get('whatsapp') === 'on',
      ip: await requestIp(),
    }));
  } catch (e) {
    if (e instanceof ConvitePacienteError) return { erro: e.message, campo: e.campo };
    throw e;
  }
  let entrou = true;
  try {
    // nextCookies grava o cookie de sessão na resposta desta Server Action
    await getAuth().api.signInEmail({ body: { email, password: senha }, headers: await headers() });
  } catch {
    entrou = false; // a senha já foi gravada: cai no login normal
  }
  redirect(entrou ? '/p/inicio' : '/entrar?volta=%2Fp%2Finicio');
}

export async function vincularContaAction(token: string, _prev: AceitePacienteState, formData: FormData): Promise<AceitePacienteState> {
  const { user } = await requireUser(['paciente'], `/convite/paciente/${token}`);
  try {
    await vincularContaExistente({
      token,
      userId: user.id,
      aceitouTermo: formData.get('termo') === 'on',
      whatsapp: formData.get('whatsapp') === 'on',
      ip: await requestIp(),
    });
  } catch (e) {
    if (e instanceof ConvitePacienteError) return { erro: e.message, campo: e.campo };
    throw e;
  }
  redirect('/p/inicio');
}
```

`src/app/convite/paciente/[token]/form.tsx`

```tsx
'use client';

import { useActionState, useState } from 'react';
import { TERMO_PACIENTE_ROTULO } from '@/modules/pacientes/termo-paciente';
import type { AceitePacienteState } from './actions';

const ERRO_ID = 'erro-aceite';

type Props = {
  acao: (prev: AceitePacienteState, formData: FormData) => Promise<AceitePacienteState>;
  /** Conta nova pede senha; quem já tem conta só confirma o termo e o WhatsApp. */
  pedeSenha: boolean;
  temTelefone: boolean;
  whatsappMarcado: boolean;
};

export function AceiteForm({ acao, pedeSenha, temTelefone, whatsappMarcado }: Props) {
  const [state, action, pendente] = useActionState<AceitePacienteState, FormData>(acao, {});
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [termo, setTermo] = useState(false);
  // controlada: o React 19 reseta campos não controlados depois de cada action, e um opt-in desmarcado
  // voltaria marcado após um erro de senha (consentimento sem intenção)
  const [whatsapp, setWhatsapp] = useState(whatsappMarcado);
  const senhaInvalida = state.campo === 'senha' || state.campo === 'confirmacao';
  return (
    <form action={action} className="space-y-3">
      {pedeSenha && (
        <>
          <p className="text-sm" id="regra-senha">Mínimo de 10 caracteres, com pelo menos 1 letra e 1 número.</p>
          <label htmlFor="senha" className="block">Nova senha</label>
          <input id="senha" name="senha" type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)}
            aria-invalid={senhaInvalida ? true : undefined} aria-describedby={senhaInvalida ? `regra-senha ${ERRO_ID}` : 'regra-senha'} className="w-full rounded border p-2" />
          <label htmlFor="confirmacao" className="block">Repita a senha</label>
          <input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)}
            aria-invalid={state.campo === 'confirmacao' ? true : undefined} aria-describedby={state.campo === 'confirmacao' ? ERRO_ID : undefined} className="w-full rounded border p-2" />
        </>
      )}
      <div className="flex items-start gap-2">
        <input id="termo" name="termo" type="checkbox" className="mt-1" checked={termo} onChange={(e) => setTermo(e.target.checked)}
          aria-invalid={state.campo === 'termo' ? true : undefined} aria-describedby={state.campo === 'termo' ? ERRO_ID : undefined} />
        <label htmlFor="termo">{TERMO_PACIENTE_ROTULO}</label>
      </div>
      {temTelefone && (
        <div className="flex items-start gap-2">
          <input id="whatsapp" name="whatsapp" type="checkbox" className="mt-1" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
          <label htmlFor="whatsapp">Quero receber lembretes por WhatsApp</label>
        </div>
      )}
      {state.erro && (
        <p id={ERRO_ID} role="alert" className="text-red-700">
          {state.erro}
        </p>
      )}
      {/* US-011 "Consentimento obrigatório": sem o termo, o botão fica desabilitado */}
      <button disabled={pendente || !termo} className="w-full rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Continuar</button>
    </form>
  );
}
```

`src/app/convite/paciente/[token]/page.tsx`

```tsx
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { SUSPENDED_PATH } from '@/lib/session-rules';
import { normalizeEmail } from '@/lib/text';
import { inspecionarConvitePaciente, MSG_CONVITE_PACIENTE } from '@/modules/pacientes/convite-paciente';
import { TERMO_PACIENTE_PARAGRAFOS, TERMO_PACIENTE_TITULO } from '@/modules/pacientes/termo-paciente';
import { aceitarConvitePacienteAction, vincularContaAction } from './actions';
import { AceiteForm } from './form';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /convite/*)
export const metadata: Metadata = { title: 'Convite', referrer: 'no-referrer' };

function Aviso({ texto }: { texto: string }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Convite</h1>
      <p role="alert">{texto}</p>
      <a href="/entrar" className="underline">Ir para o login</a>
    </main>
  );
}

function Termo() {
  return (
    <section aria-labelledby="termo-titulo" tabIndex={0} className="max-h-64 space-y-2 overflow-y-auto rounded border p-3 text-sm">
      <h2 id="termo-titulo" className="font-semibold">{TERMO_PACIENTE_TITULO}</h2>
      {TERMO_PACIENTE_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}
    </section>
  );
}

export default async function ConvitePacientePage({ params }: PageProps<'/convite/paciente/[token]'>) {
  const { token } = await params;
  const e = await inspecionarConvitePaciente(getDb(), token);
  if (e.estado === 'expirado') return <Aviso texto={MSG_CONVITE_PACIENTE.expirado} />;
  if (e.estado === 'invalido') return <Aviso texto={MSG_CONVITE_PACIENTE.invalido} />;
  if (e.tenantSuspenso) redirect(SUSPENDED_PATH);
  if (e.conta === 'equipe') return <Aviso texto={MSG_CONVITE_PACIENTE.contaDeEquipe} />;

  if (e.conta === 'paciente') {
    const sessao = await getAuth().api.getSession({ headers: await headers() });
    if (!sessao) {
      const volta = encodeURIComponent(`/convite/paciente/${token}`);
      return (
        <main className="mx-auto max-w-lg space-y-4 p-6">
          <h1 className="text-2xl font-semibold">{`Convite de ${e.nutri}`}</h1>
          <p>{`Entre com sua conta existente para ver os dados da nutricionista ${e.nutri}.`}</p>
          <a href={`/entrar?volta=${volta}`} className="inline-block rounded bg-emerald-700 px-4 py-2 text-white">Entrar</a>
        </main>
      );
    }
    if (normalizeEmail(sessao.user.email) !== normalizeEmail(e.email)) return <Aviso texto={MSG_CONVITE_PACIENTE.outraConta} />;
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{`Convite de ${e.nutri}`}</h1>
        <p>Leia o termo e confirme para ver seu acompanhamento com esta nutricionista.</p>
        <Termo />
        <AceiteForm acao={vincularContaAction.bind(null, token)} pedeSenha={false} temTelefone={e.temTelefone} whatsappMarcado={e.whatsappMarcado} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Bem-vindo(a) ao NutriDebby</h1>
      <p>{`${e.nutri} convidou você. Crie a senha de ${e.email} e leia o termo para continuar.`}</p>
      <Termo />
      <AceiteForm acao={aceitarConvitePacienteAction.bind(null, token)} pedeSenha temTelefone={e.temTelefone} whatsappMarcado={e.whatsappMarcado} />
    </main>
  );
}
```

Run: `pnpm typecheck`
Expected: sem erros.

- [ ] **Step 5: E2E do convite** — acrescentar ao `e2e/pacientes.spec.ts` (import no topo: `import { esperarEmail, primeiroLink } from './mailpit';`), depois do teste de cadastro:

```ts
test('o paciente recebe o convite, cria a senha, aceita o termo e chega ao portal; o link não vale de novo (US-010, US-011)', async ({ browser }) => {
  const email = await esperarEmail(ANA.email, { assunto: 'Convite de Consultório E2E no NutriDebby' });
  const link = primeiroLink(email.texto, '/convite/paciente/');
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.5.2' } });
  const page = await ctx.newPage();
  const resposta = await page.goto(link);
  expect(resposta?.headers()['referrer-policy']).toBe('no-referrer');
  await page.getByLabel('Nova senha').fill(ANA.senha);
  await page.getByLabel('Repita a senha').fill(ANA.senha);
  const continuar = page.getByRole('button', { name: 'Continuar' });
  await expect(continuar).toBeDisabled(); // US-011 "Consentimento obrigatório"
  await page.getByLabel(/^Li e aceito o Termo de Uso e Privacidade \(versão /).check();
  await expect(page.getByLabel('Quero receber lembretes por WhatsApp')).toBeChecked(); // a nutricionista autorizou
  await continuar.click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await expect(page.getByRole('heading', { name: 'Meu acompanhamento' })).toBeVisible();
  await page.goto(link);
  await expect(page.locator('p[role="alert"]')).toContainText('Convite inválido ou já usado.');
  await ctx.close();

  await nutri.goto(prontuario);
  await expect(nutri.getByText('Ativo: o paciente já criou a senha.')).toBeVisible();
});
```

Run: `pnpm build && pnpm test:e2e e2e/pacientes.spec.ts`
Expected: PASS.

- [ ] **Step 6: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/modules/pacientes src/app/convite/paciente e2e/pacientes.spec.ts
git commit -m "feat(pacientes): aceite do convite com senha, termo versionado e opt-in de WhatsApp; conta existente vincula o novo prontuário (P03-02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Etiquetas de paciente + política `staff_only` (P03-03)

**Files:**
- Create: `drizzle/0019_etiquetas.sql` (gerada), `drizzle/0020_rls_etiquetas.sql` (custom), `src/modules/pacientes/etiquetas.ts`, `src/modules/pacientes/etiquetas.test.ts`, `src/app/painel/pacientes/[id]/etiquetas-form.tsx`
- Modify: `src/db/schema/pacientes.ts`, `src/db/rls-guard.ts`, `src/db/rls-guard.test.ts`, `test/isolamento.test.ts`, `src/modules/pacientes/pacientes.ts` (filtro), `src/modules/plataforma/audit.ts` (rótulo), `src/app/painel/pacientes/page.tsx`, `src/app/painel/pacientes/actions.ts`, `src/app/painel/pacientes/[id]/page.tsx`, `CLAUDE.md` (regra 2)

**Interfaces:**
- Consumes: `patients`, `citext` (Tarefa 1, `src/db/schema/pacientes.ts`); `carregarPacienteParaEscrita`, `idValido` (Tarefa 1); `auditRead`; `findStaleExceptions`, `RLS_EXCEPTIONS`, `PATIENT_POLICY_EXCEPTIONS` (`@/db/rls-guard`); `novoTenant`, `novoPaciente`, `ctxPaciente` (`test/pacientes.ts`).
- Produces:
  - SQL: `app_enable_staff_only(tbl regclass)` — política RESTRICTIVE `staff_only` (`app_current_role() IS DISTINCT FROM 'paciente'`). A Tarefa 10 usa em `consultation_notes`.
  - Schema: `patientTags` 🔒 (`nome` citext, UNIQUE por tenant), `patientTagLinks` 🔒 (`patient_id`, `tag_id`, FKs compostas).
  - `@/db/rls-guard`: `STAFF_ONLY: Record<string, string>`, `findStaffOnlyViolations(db): Promise<RlsViolation[]>`.
  - `@/modules/pacientes/etiquetas`: `MSG_ETIQUETA`, `class EtiquetaError`, `type Etiqueta = { id; nome }`, `listarEtiquetas(ctx, db?): Promise<(Etiqueta & { pacientes: number })[]>`, `etiquetasDoPaciente(ctx, patientId, db?): Promise<Etiqueta[]>` (audita), `salvarEtiquetasDoPaciente(ctx, patientId, { etiquetas: string[]; nova?: string }, db?): Promise<void>`.
  - `listarPacientes(ctx, { busca?, status?, etiquetaId? })`.
  - Action `salvarEtiquetasAction(patientId, prev, formData)`, `type EtiquetasState`.

- [ ] **Step 1: Tabelas** — acrescentar ao `src/db/schema/pacientes.ts` (imports: acrescentar `foreignKey` ao de `drizzle-orm/pg-core`):

```ts
/** US-019. Nome sem diferenciar maiúsculas ("Gestante" = "gestante"). A sessão de paciente não vê (staff_only). */
export const patientTags = pgTable(
  'patient_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: citext('nome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patient_tags_tenant_nome_unique').on(t.tenantId, t.nome),
    unique('patient_tags_tenant_id_unique').on(t.tenantId, t.id),
    check('patient_tags_nome_tamanho', sql`char_length(${t.nome}) between 1 and 40`),
  ],
);

export const patientTagLinks = pgTable(
  'patient_tag_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patient_tag_links_unique').on(t.patientId, t.tagId),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'patient_tag_links_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.tagId], foreignColumns: [patientTags.tenantId, patientTags.id], name: 'patient_tag_links_etiqueta_fk' }).onDelete('cascade'),
    index('patient_tag_links_etiqueta_idx').on(t.tenantId, t.tagId),
  ],
);
```

Run: `pnpm db:generate --name etiquetas`
Expected: `drizzle/0019_etiquetas.sql` com as 2 tabelas, as UNIQUE, o CHECK e as FKs compostas (`FOREIGN KEY ("tenant_id","patient_id") REFERENCES "patients"("tenant_id","id")`).

Run: `pnpm drizzle-kit generate --custom --name rls_etiquetas` e preencher `drizzle/0020_rls_etiquetas.sql`:

```sql
-- US-016 / US-019: tabelas que a sessão de paciente nunca vê, nem as próprias linhas (notas
-- privadas, etiquetas). RESTRICTIVE: soma-se (AND) às políticas de tenant e de paciente.
CREATE OR REPLACE FUNCTION app_enable_staff_only(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS staff_only ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY staff_only ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_current_role() IS DISTINCT FROM %L) WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
    tbl, 'paciente', 'paciente');
END $$;
--> statement-breakpoint
SELECT app_enable_tenant_rls('patient_tags');
--> statement-breakpoint
SELECT app_enable_staff_only('patient_tags');
--> statement-breakpoint
SELECT app_enable_tenant_rls('patient_tag_links');
--> statement-breakpoint
SELECT app_enable_patient_rls('patient_tag_links');
--> statement-breakpoint
SELECT app_enable_staff_only('patient_tag_links');
--> statement-breakpoint
-- "gestante", "diabetes": etiqueta é dado de saúde
SELECT app_enable_audit('patient_tag_links', 'etiquetas');
```

- [ ] **Step 2: Guarda de `staff_only`** — em `src/db/rls-guard.ts`, acrescentar:

```ts
/** Tabelas que a sessão de paciente nunca vê (política RESTRICTIVE staff_only), com o motivo. */
export const STAFF_ONLY: Record<string, string> = {
  patient_tags: 'US-019: o paciente não vê etiquetas, nem no JSON da API',
  patient_tag_links: 'US-019: o paciente não vê etiquetas, nem no JSON da API',
};

export async function findStaffOnlyViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string }>(
    `select tablename as t from pg_policies
      where schemaname = 'public' and policyname = 'staff_only' and permissive = 'RESTRICTIVE'`,
  );
  const com = new Set(rows.map((r) => r.t));
  return Object.keys(STAFF_ONLY)
    .filter((t) => !com.has(t))
    .map((table) => ({ table, problem: 'sem política staff_only (app_enable_staff_only)' }));
}
```

Acrescentar ao `src/db/rls-guard.test.ts` (imports: `findStaffOnlyViolations`, `findStaleExceptions`, `PATIENT_POLICY_EXCEPTIONS`, `RLS_EXCEPTIONS`, `STAFF_ONLY`):

```ts
describe('staff_only (US-016, US-019)', () => {
  it('toda tabela da lista STAFF_ONLY tem a política, e a lista não cita tabela inexistente', async () => {
    expect(await findStaffOnlyViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { RLS_EXCEPTIONS, PATIENT_POLICY_EXCEPTIONS, STAFF_ONLY })).toEqual([]);
  });
  it('detecta a tabela da lista sem a política (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy staff_only on patient_tags');
      expect(await findStaffOnlyViolations(client)).toContainEqual({ table: 'patient_tags', problem: 'sem política staff_only (app_enable_staff_only)' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
```

Em `test/isolamento.test.ts`, acrescentar ao `FABRICAS`:

```ts
  patient_tags: (t) => sql`insert into patient_tags (tenant_id, nome) values (${t}, ${`iso-${randomUUID().slice(0, 8)}`})`,
  patient_tag_links: (t, p) => sql`with e as (insert into patient_tags (tenant_id, nome) values (${t}, ${`iso-${randomUUID().slice(0, 8)}`}) returning id)
    insert into patient_tag_links (tenant_id, patient_id, tag_id) select ${t}, ${p}, e.id from e`,
```

Run: `pnpm test src/db test/isolamento.test.ts`
Expected: PASS — agora o teste "staff_only" da matriz itera `patient_tags` e `patient_tag_links`. Conferir que ele falha se a linha `SELECT app_enable_staff_only('patient_tag_links');` for removida da migration (desfazer depois).

- [ ] **Step 3: Testes que falham do serviço** — `src/modules/pacientes/etiquetas.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, patients, patientTagLinks, patientTags } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';
import { etiquetasDoPaciente, EtiquetaError, listarEtiquetas, MSG_ETIQUETA, salvarEtiquetasDoPaciente } from './etiquetas';
import { listarPacientes } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('etiquetas (US-019)', () => {
  it('"Etiquetar e filtrar": a lista por "gestante" traz exatamente os 3 etiquetados', async () => {
    const T = await novoTenant(app.db);
    const ps = await Promise.all(['Ana', 'Bia', 'Cris', 'Duda', 'Eva'].map((nome) => novoPaciente(app.db, T.ctx, { nome })));
    await salvarEtiquetasDoPaciente(T.ctx, ps[0].id, { etiquetas: [], nova: 'gestante' }, app.db);
    const [gestante] = await listarEtiquetas(T.ctx, app.db);
    for (const p of [ps[2], ps[4]]) await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [gestante.id] }, app.db);
    expect((await listarPacientes(T.ctx, { etiquetaId: gestante.id }, app.db)).map((p) => p.nome)).toEqual(['Ana', 'Cris', 'Eva']);
    expect(await listarEtiquetas(T.ctx, app.db)).toEqual([{ id: gestante.id, nome: 'gestante', pacientes: 3 }]);
    expect(await listarPacientes(T.ctx, { etiquetaId: 'abc' }, app.db)).toEqual([]);
    // filtrar por etiqueta revela quem tem a condição (dado de saúde): uma leitura auditada por paciente devolvido
    const lidos = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'etiquetas'), eq(auditLog.acao, 'ler'))), app.db);
    expect(lidos.map((l) => l.patientId).sort()).toEqual([ps[0].id, ps[2].id, ps[4].id].sort());
    // a contagem do seletor é a mesma da lista padrão (só ativos)
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, ps[4].id)), app.db);
    expect(await listarEtiquetas(T.ctx, app.db)).toEqual([{ id: gestante.id, nome: 'gestante', pacientes: 2 }]);
  });

  it('"Gestante" reaproveita "gestante"; salvar troca o conjunto inteiro; auditoria "criar"/"excluir" com a nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'gestante' }, app.db);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: '  Gestante ' }, app.db);
    expect(await listarEtiquetas(T.ctx, app.db)).toHaveLength(1);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'diabetes' }, app.db);
    expect((await etiquetasDoPaciente(T.ctx, p.id, app.db)).map((e) => e.nome)).toEqual(['diabetes']);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.entidade, 'etiquetas'))), app.db);
    expect(log.map((l) => l.acao).sort()).toEqual(['criar', 'criar', 'excluir', 'ler']);
    expect(log.every((l) => l.actorUserId === T.nutriId)).toBe(true);
  });

  it('nome com mais de 40 caracteres é recusado; etiqueta de outro tenant é ignorada; bloqueado e outro tenant recusam', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const p = await novoPaciente(app.db, A.ctx);
    await expect(salvarEtiquetasDoPaciente(A.ctx, p.id, { etiquetas: [], nova: 'x'.repeat(41) }, app.db)).rejects.toThrow(MSG_ETIQUETA.nome);
    await expect(salvarEtiquetasDoPaciente(A.ctx, p.id, { etiquetas: [], nova: 'x'.repeat(41) }, app.db)).rejects.toBeInstanceOf(EtiquetaError);
    const pb = await novoPaciente(app.db, B.ctx);
    await salvarEtiquetasDoPaciente(B.ctx, pb.id, { etiquetas: [], nova: 'de-b' }, app.db);
    const [deB] = await listarEtiquetas(B.ctx, app.db);
    await salvarEtiquetasDoPaciente(A.ctx, p.id, { etiquetas: [deB.id, randomUUID(), 'lixo'] }, app.db);
    expect(await etiquetasDoPaciente(A.ctx, p.id, app.db)).toEqual([]);
    await expect(salvarEtiquetasDoPaciente(A.ctx, pb.id, { etiquetas: [] }, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(salvarEtiquetasDoPaciente(A.ctx, bloqueado.id, { etiquetas: [], nova: 'x' }, app.db)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('"Paciente não vê etiquetas": na sessão dele, nenhuma etiqueta nem vínculo, nem os próprios', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'diabetes' }, app.db);
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await withTenant(ctx, (tx) => tx.select().from(patientTags), app.db)).toEqual([]);
    expect(await withTenant(ctx, (tx) => tx.select().from(patientTagLinks), app.db)).toEqual([]);
    expect(await etiquetasDoPaciente(ctx, p.id, app.db)).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/pacientes/etiquetas.test.ts`
Expected: FAIL — `Cannot find module './etiquetas'`.

- [ ] **Step 4: Implementar** — `src/modules/pacientes/etiquetas.ts`

```ts
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients, patientTagLinks, patientTags } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido } from './base';

export const MSG_ETIQUETA = { nome: 'Use de 1 a 40 caracteres na etiqueta' } as const;

export class EtiquetaError extends Error {
  override name = 'EtiquetaError';
}

export type Etiqueta = { id: string; nome: string };

export async function listarEtiquetas(ctx: TenantContext, db: Db = getDb()): Promise<(Etiqueta & { pacientes: number })[]> {
  return withTenant(
    ctx,
    (tx) =>
      tx
        // conta só pacientes ativos: o mesmo universo da lista padrão, para o "(3)" do seletor bater com a lista
        .select({ id: patientTags.id, nome: patientTags.nome, pacientes: count(patients.id) })
        .from(patientTags)
        .leftJoin(patientTagLinks, eq(patientTagLinks.tagId, patientTags.id))
        .leftJoin(patients, and(eq(patients.id, patientTagLinks.patientId), eq(patients.status, 'ativo')))
        .groupBy(patientTags.id)
        .orderBy(asc(patientTags.nome)),
    db,
  );
}

/** Etiquetas do paciente (dado de saúde: "diabetes", "gestante") — leitura auditada. Paciente nunca vê (staff_only). */
export async function etiquetasDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Etiqueta[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: patientTags.id, nome: patientTags.nome })
        .from(patientTagLinks)
        .innerJoin(patientTags, eq(patientTags.id, patientTagLinks.tagId))
        .where(eq(patientTagLinks.patientId, patientId))
        .orderBy(asc(patientTags.nome));
      if (r.length) await auditRead(tx, { entidade: 'etiquetas', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

/**
 * Deixa o paciente com exatamente `etiquetas` (+ a `nova`, criada se não existir — sem diferenciar
 * maiúsculas). Id de etiqueta de outro tenant ou malformado é ignorado: só vale o que a RLS mostra.
 */
export async function salvarEtiquetasDoPaciente(
  ctx: TenantContext,
  patientId: string,
  input: { etiquetas: string[]; nova?: string },
  db: Db = getDb(),
): Promise<void> {
  const nova = input.nova?.trim().replace(/\s+/g, ' ') ?? '';
  if (nova.length > 40) throw new EtiquetaError(MSG_ETIQUETA.nome);
  await withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const pedidas = input.etiquetas.filter(idValido);
      const validas = pedidas.length
        ? (await tx.select({ id: patientTags.id }).from(patientTags).where(inArray(patientTags.id, pedidas))).map((e) => e.id)
        : [];
      const alvo = new Set(validas);
      if (nova) {
        await tx.insert(patientTags).values({ tenantId: ctx.tenantId, nome: nova }).onConflictDoNothing();
        const [e] = await tx.select({ id: patientTags.id }).from(patientTags).where(eq(patientTags.nome, nova));
        alvo.add(e.id);
      }
      const atuais = (await tx.select({ tagId: patientTagLinks.tagId }).from(patientTagLinks).where(eq(patientTagLinks.patientId, patientId))).map((l) => l.tagId);
      const remover = atuais.filter((id) => !alvo.has(id));
      const incluir = [...alvo].filter((id) => !atuais.includes(id));
      if (remover.length) await tx.delete(patientTagLinks).where(and(eq(patientTagLinks.patientId, patientId), inArray(patientTagLinks.tagId, remover)));
      if (incluir.length) {
        await tx
          .insert(patientTagLinks)
          .values(incluir.map((tagId) => ({ tenantId: ctx.tenantId, patientId, tagId })))
          .onConflictDoNothing();
      }
    },
    db,
  );
}
```

Em `src/modules/pacientes/pacientes.ts`, trocar `listarPacientes` inteira (e o comentário acima dela) por:

```ts
/**
 * Lista do painel (nome e contato; abrir o prontuário audita). Busca sem acento por nome ou e-mail;
 * `%`, `_` e `\` digitados são literais. Com `etiquetaId`, a lista diz quem tem "diabetes", "gestante":
 * é dado de saúde (regra 8), então cada paciente devolvido gera uma leitura auditada de "Etiquetas".
 */
export async function listarPacientes(
  ctx: TenantContext,
  filtro: { busca?: string; status?: StatusPaciente; etiquetaId?: string },
  db: Db = getDb(),
): Promise<PacienteNaLista[]> {
  if (filtro.etiquetaId !== undefined && !idValido(filtro.etiquetaId)) return [];
  const conds: SQL[] = [eq(patients.status, filtro.status ?? 'ativo')];
  if (filtro.etiquetaId) {
    conds.push(sql`exists (select 1 from patient_tag_links l where l.patient_id = ${patients.id} and l.tag_id = ${filtro.etiquetaId})`);
  }
  const busca = filtro.busca?.trim();
  if (busca) {
    const termo = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql`(unaccent(${patients.nome}) ilike unaccent(${termo}) or ${patients.email}::text ilike ${termo})`);
  }
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({
          id: patients.id,
          nome: patients.nome,
          email: patients.email,
          status: patients.status,
          dataNascimento: patients.dataNascimento,
          userId: patients.userId,
          origem: patients.origem,
        })
        .from(patients)
        .where(and(...conds))
        .orderBy(asc(patients.nome))
        .limit(LIMITE_LISTA);
      if (filtro.etiquetaId) for (const p of r) await auditRead(tx, { entidade: 'etiquetas', entidadeId: null, patientId: p.id });
      return r;
    },
    db,
  );
}
```

Em `src/modules/plataforma/audit.ts`, acrescentar ao `ENTIDADE_ROTULO`: `etiquetas: 'Etiquetas',`.

Run: `pnpm test src/modules/pacientes`
Expected: PASS.

- [ ] **Step 5: Telas** — em `src/app/painel/pacientes/actions.ts`, acrescentar:

```ts
import { EtiquetaError, salvarEtiquetasDoPaciente } from '@/modules/pacientes/etiquetas';

export type EtiquetasState = { erro?: string; ok?: boolean };

export async function salvarEtiquetasAction(patientId: string, _prev: EtiquetasState, formData: FormData): Promise<EtiquetasState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}`);
  try {
    await salvarEtiquetasDoPaciente(ctx, patientId, {
      etiquetas: formData.getAll('etiquetas').map(String),
      nova: String(formData.get('nova') ?? ''),
    });
  } catch (e) {
    if (e instanceof EtiquetaError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`);
  return { ok: true };
}
```

`src/app/painel/pacientes/[id]/etiquetas-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import type { Etiqueta } from '@/modules/pacientes/etiquetas';
import type { EtiquetasState } from '../actions';

type Props = {
  acao: (prev: EtiquetasState, formData: FormData) => Promise<EtiquetasState>;
  todas: Etiqueta[];
  doPaciente: string[];
  somenteLeitura: boolean;
};

export function EtiquetasForm({ acao, todas, doPaciente, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<EtiquetasState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={somenteLeitura} className="space-y-2">
        <legend className="sr-only">Etiquetas do paciente</legend>
        {todas.length === 0 && <p className="text-sm text-zinc-700">Nenhuma etiqueta criada ainda.</p>}
        {todas.map((e) => (
          <div key={e.id} className="flex items-center gap-2">
            <input id={`etiqueta-${e.id}`} name="etiquetas" type="checkbox" value={e.id} defaultChecked={doPaciente.includes(e.id)} />
            <label htmlFor={`etiqueta-${e.id}`}>{e.nome}</label>
          </div>
        ))}
        <div className="space-y-1">
          <label htmlFor="nova" className="block font-medium">Nova etiqueta</label>
          <input id="nova" name="nova" maxLength={40} className="w-full rounded border p-2" aria-describedby={state.erro ? 'etiquetas-erro' : undefined} />
        </div>
      </fieldset>
      {state.erro && <p id="etiquetas-erro" role="alert" className="text-red-700">{state.erro}</p>}
      {state.ok && <p role="status">Etiquetas salvas.</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded border px-4 py-2">Salvar etiquetas</button>}
    </form>
  );
}
```

Em `src/app/painel/pacientes/[id]/page.tsx`, importar `listarEtiquetas` e `etiquetasDoPaciente` (`@/modules/pacientes/etiquetas`), `salvarEtiquetasAction` (`../actions`) e `EtiquetasForm` (`./etiquetas-form`); buscar `const [todas, doPaciente] = await Promise.all([listarEtiquetas(ctx), etiquetasDoPaciente(ctx, paciente.id)]);` e acrescentar, depois da seção "Acesso ao portal":

```tsx
      <section aria-labelledby="etiquetas-titulo" className="space-y-2">
        <h2 id="etiquetas-titulo" className="text-lg font-semibold">Etiquetas</h2>
        <p className="text-sm text-zinc-700">Só você vê as etiquetas. Use para filtrar a lista e direcionar conteúdos.</p>
        <EtiquetasForm acao={salvarEtiquetasAction.bind(null, paciente.id)} todas={todas} doPaciente={doPaciente.map((e) => e.id)} somenteLeitura={bloqueado} />
      </section>
```

Em `src/app/painel/pacientes/page.tsx`: importar `listarEtiquetas`; ler `const etiquetaId = texto(sp.etiqueta);`, `const etiquetas = await listarEtiquetas(ctx);`; passar `etiquetaId: etiquetaId || undefined` para `listarPacientes`; e acrescentar ao formulário de busca, antes do botão "Filtrar":

```tsx
          <div className="space-y-1">
            <label htmlFor="etiqueta" className="block font-medium">Etiqueta</label>
            <select id="etiqueta" name="etiqueta" defaultValue={etiquetaId} className="rounded border p-2">
              <option value="">Todas</option>
              {etiquetas.map((e) => <option key={e.id} value={e.id}>{`${e.nome} (${e.pacientes})`}</option>)}
            </select>
          </div>
```

- [ ] **Step 6: CLAUDE.md** — na regra 2, acrescentar ao fim: `Tabela que o paciente nunca pode ver, nem as próprias linhas (notas privadas, etiquetas): também SELECT app_enable_staff_only('<tabela>'); e a entrada em STAFF_ONLY (src/db/rls-guard.ts).`

- [ ] **Step 7: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/db drizzle/0019_etiquetas.sql drizzle/0020_rls_etiquetas.sql drizzle/meta test/isolamento.test.ts \
  src/modules/pacientes src/modules/plataforma/audit.ts src/app/painel/pacientes CLAUDE.md
git commit -m "feat(pacientes): etiquetas com filtro na lista e política staff_only (paciente nunca vê) com guarda no CI (P03-03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Biblioteca de fórmulas (Apêndice A) e números em pt-BR (P03-05)

**Files:**
- Create: `src/lib/numero.ts`, `src/lib/numero.test.ts`, `src/modules/pacientes/formulas.ts`, `src/modules/pacientes/formulas.test.ts`

**Interfaces:**
- Consumes: nada do banco (funções puras; também rodam no navegador, na prévia dos formulários).
- Produces:
  - `@/lib/numero`: `lerDecimal(v: unknown): number | null` (vazio → `null`; lixo → `NaN`), `arredondar(v: number, casas?: number): number` (meio para cima), `formatarDecimal(v: number, casas: number): string` (vírgula, sem separador de milhar), `decimalEntre(msg, min, max)` e `decimalOpcionalEntre(msg, min, max)` (schemas Zod de campo de formulário).
  - `@/modules/pacientes/formulas`: `type Sexo`, `type Protocolo = 'jp3' | 'jp7'`, `DOBRAS` (`{ id, rotulo }[]`), `type DobraId`, `dobrasDoProtocolo(p, sexo): DobraId[]`, `imc(pesoKg, alturaCm): number`, `densidadeJP(p, sexo, somaMm, idade): number`, `siri(densidade): number`, `type ResultadoGordura`, `calcularGordura(p, sexo, idade, dobras): ResultadoGordura`, `type FormulaTmb = 'harris_benedict' | 'mifflin' | 'fao_oms'`, `FORMULAS_TMB` (`{ id, nome }[]`), `type DadosTmb`, `tmb(f, d): number`, `gastoTotal(tmbKcal, fator): number`, `kcal(v): number`, `compararTmb(d): Record<FormulaTmb, number>`, `FATOR_MIN = 1`, `FATOR_MAX = 2.5`.

- [ ] **Step 1: Testes que falham dos números** — `src/lib/numero.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { arredondar, decimalEntre, decimalOpcionalEntre, formatarDecimal, lerDecimal } from './numero';

describe('números digitados em pt-BR (RNF-12, Review Focus 2)', () => {
  it('vírgula ou ponto decimal, espaços ignorados; vazio é null; lixo é NaN', () => {
    expect(lerDecimal('70,5')).toBe(70.5);
    expect(lerDecimal('70.5')).toBe(70.5);
    expect(lerDecimal(' 70 ')).toBe(70);
    expect(lerDecimal('1,55')).toBe(1.55);
    expect(lerDecimal('')).toBeNull();
    expect(lerDecimal('   ')).toBeNull();
    expect(lerDecimal(undefined)).toBeNull();
    for (const v of ['7O', '70,5 kg', '1.234,5', '70,', ',5', 'NaN', '1e3']) expect(lerDecimal(v), v).toBeNaN();
  });
  it('arredonda meio para cima sem erro de ponto flutuante (RN-14)', () => {
    expect(arredondar(1.005, 2)).toBe(1.01);
    expect(arredondar(1648.75)).toBe(1649);
    expect(arredondar(2007.6375)).toBe(2008);
    expect(arredondar(22.857142857, 2)).toBe(22.86);
  });
  it('formata com vírgula e as casas pedidas, sem separador de milhar', () => {
    expect(formatarDecimal(22.857142857, 2)).toBe('22,86');
    expect(formatarDecimal(70, 1)).toBe('70,0');
    expect(formatarDecimal(2008, 0)).toBe('2008');
  });
  it('schemas de campo: fora da faixa, vazio ou lixo → a mensagem do campo (nunca NaN gravado)', () => {
    const peso = z.object({ p: decimalEntre('Peso deve estar entre 1 e 400 kg', 1, 400) });
    expect(peso.parse({ p: '70,5' })).toEqual({ p: 70.5 });
    for (const p of ['0', '500', '', '7O']) expect(peso.safeParse({ p }).error?.issues[0].message, p).toBe('Peso deve estar entre 1 e 400 kg');
    const circ = z.object({ c: decimalOpcionalEntre('Circunferência deve estar entre 5 e 300 cm', 5, 300) });
    expect(circ.parse({ c: '' })).toEqual({ c: null });
    expect(circ.safeParse({ c: '2' }).success).toBe(false);
  });
});
```

Run: `pnpm test src/lib/numero.test.ts`
Expected: FAIL — `Cannot find module './numero'`.

- [ ] **Step 2: Implementar os números** — `src/lib/numero.ts`

```ts
import { z } from 'zod';

/** Número digitado ("70,5", "70.5", " 70 "). Vazio → null; qualquer outra coisa (unidade, milhar, letra) → NaN. */
export function lerDecimal(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return Number.NaN;
  return Number(t.replace(',', '.'));
}

/** Meio para cima em `casas` decimais (RN-14). Pela notação exponencial: 1.005 → 1.01 (e não 1.00). */
export function arredondar(v: number, casas = 0): number {
  if (!Number.isFinite(v) || String(v).includes('e')) return Math.round(v * 10 ** casas) / 10 ** casas;
  return Number(`${Math.round(Number(`${v}e${casas}`))}e-${casas}`);
}

/** Vírgula decimal (RNF-12), sem separador de milhar ("2008 kcal", como a spec escreve). */
export function formatarDecimal(v: number, casas: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false }).format(arredondar(v, casas));
}

/** Campo numérico obrigatório de formulário: vazio, lixo ou fora de [min, max] → `msg`. */
export const decimalEntre = (msg: string, min: number, max: number) =>
  z.unknown().transform((v, ctx) => {
    const n = lerDecimal(v);
    if (n === null || Number.isNaN(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });

/** Igual a `decimalEntre`, mas vazio vale `null`. */
export const decimalOpcionalEntre = (msg: string, min: number, max: number) =>
  z.unknown().transform((v, ctx): number | null => {
    const n = lerDecimal(v);
    if (n === null) return null;
    if (Number.isNaN(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });
```

Run: `pnpm test src/lib/numero.test.ts`
Expected: PASS.

- [ ] **Step 3: Testes que falham das fórmulas** — `src/modules/pacientes/formulas.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { arredondar } from '@/lib/numero';
import { calcularGordura, compararTmb, densidadeJP, dobrasDoProtocolo, gastoTotal, imc, kcal, siri, tmb } from './formulas';

/** Apêndice A: "casos de teste unitário obrigatórios do cálculo (tolerância ±0,01)". */
const perto = (v: number, esperado: number) => expect(Math.abs(v - esperado), `${v} ≠ ${esperado}`).toBeLessThanOrEqual(0.01);

describe('Apêndice A — casos obrigatórios', () => {
  it('IMC: 70 kg, 175 cm → 22,86', () => {
    perto(imc(70, 175), 22.86);
    expect(arredondar(imc(70, 175), 2)).toBe(22.86);
  });

  it('Harris-Benedict mulher 60 kg, 165 cm, 35 anos → 1370,47 pela fórmula da spec (exibido 1370; a spec escreve 1370,5/1371 — P-08)', () => {
    const v = tmb('harris_benedict', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 });
    perto(v, 1370.47);
    expect(kcal(v)).toBe(1370);
    perto(tmb('harris_benedict', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 30 }), 1701.85);
  });

  it('Mifflin-St Jeor: homem 70/175/30 → 1648,75; mulher 60/165/35 → 1295,25 (TMB 1295, GET × 1,55 = 2008)', () => {
    perto(tmb('mifflin', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 30 }), 1648.75);
    const f = tmb('mifflin', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 });
    perto(f, 1295.25);
    expect(kcal(f)).toBe(1295);
    // GET usa a TMB sem arredondar: 1295,25 × 1,55 = 2007,64 → 2008 (1295 × 1,55 daria 2007)
    expect(kcal(gastoTotal(f, 1.55))).toBe(2008);
  });

  it('meio exato vira para cima mesmo com erro de ponto flutuante (RN-14)', () => {
    // Mifflin homem 45 kg, 150 cm, 18 anos = 1302,5; × 1,40 = 1823,5 exato (JS: 1823,4999999999998)
    const t = tmb('mifflin', { sexo: 'M', pesoKg: 45, alturaCm: 150, idade: 18 });
    perto(t, 1302.5);
    expect(kcal(t)).toBe(1303);
    expect(gastoTotal(t, 1.4)).toBe(1823.5);
    expect(kcal(gastoTotal(t, 1.4))).toBe(1824);
    expect(kcal(gastoTotal(1075, 1.38))).toBe(1484); // JS: 1483,4999999999998
    expect(kcal(1823.4999999999998)).toBe(1824);
  });

  it('FAO/OMS: mulher 60 kg, 35 anos → 1351,0; faixas 18–29, 30–59 e 60+; não se aplica a menores (RN-17)', () => {
    perto(tmb('fao_oms', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 }), 1351);
    perto(tmb('fao_oms', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 29 }), 14.7 * 60 + 496);
    perto(tmb('fao_oms', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 30 }), 11.6 * 70 + 879);
    perto(tmb('fao_oms', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 60 }), 13.5 * 70 + 487);
    expect(() => tmb('fao_oms', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 17 })).toThrow(RangeError);
  });

  it('US-014 "Comparar fórmulas": Harris-Benedict 1370, Mifflin 1295, FAO/OMS 1351', () => {
    const r = compararTmb({ sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 });
    expect({ hb: kcal(r.harris_benedict), mifflin: kcal(r.mifflin), fao: kcal(r.fao_oms) }).toEqual({ hb: 1370, mifflin: 1295, fao: 1351 });
  });

  it('Jackson & Pollock 3 dobras + Siri: homem 30 anos, S = 50 → D 1,06432 e %G 15,08; mulher 35 anos, S = 60 → D 1,04333 e %G 24,44', () => {
    perto(densidadeJP('jp3', 'M', 50, 30), 1.06432);
    const m = calcularGordura('jp3', 'M', 30, { peitoral: 15, abdominal: 20, coxa: 15 });
    expect(m).toEqual({ ok: true, densidade: 1.06432, percGordura: 15.08 });
    const f = calcularGordura('jp3', 'F', 35, { triceps: 20, suprailiaca: 20, coxa: 20 });
    expect(f).toEqual({ ok: true, densidade: 1.04333, percGordura: 24.44 });
    // O %G sai da densidade sem arredondar: com 1,06432 arredondada daria 15,09
    perto(siri(1.064323), 15.08);
  });

  it('Jackson & Pollock 7 dobras (mesmas fórmulas da spec): homem 30, S = 100 → 14,63; mulher 35, S = 100 → 20,92', () => {
    const sete = (v: number) => Object.fromEntries(dobrasDoProtocolo('jp7', 'M').map((d, i) => [d, i === 0 ? v - 6 * Math.floor(v / 7) : Math.floor(v / 7)]));
    expect(Object.values(sete(100)).reduce((a, b) => a + b, 0)).toBe(100);
    expect(calcularGordura('jp7', 'M', 30, sete(100))).toMatchObject({ ok: true, percGordura: 14.63 });
    expect(calcularGordura('jp7', 'F', 35, sete(100))).toMatchObject({ ok: true, percGordura: 20.92 });
  });

  it('dobras de cada protocolo e "Dobra faltando" (US-013)', () => {
    expect(dobrasDoProtocolo('jp3', 'M')).toEqual(['peitoral', 'abdominal', 'coxa']);
    expect(dobrasDoProtocolo('jp3', 'F')).toEqual(['triceps', 'suprailiaca', 'coxa']);
    expect(dobrasDoProtocolo('jp7', 'F')).toEqual(['peitoral', 'axilar_media', 'triceps', 'subescapular', 'abdominal', 'suprailiaca', 'coxa']);
    const semAxilar = { peitoral: 10, triceps: 10, subescapular: 10, abdominal: 10, suprailiaca: 10, coxa: 10 };
    expect(calcularGordura('jp7', 'F', 35, semAxilar)).toEqual({ ok: false, faltando: ['axilar_media'] });
    expect(calcularGordura('jp3', 'M', 30, { peitoral: 15, abdominal: null, coxa: 15 })).toEqual({ ok: false, faltando: ['abdominal'] });
  });
});
```

Run: `pnpm test src/modules/pacientes/formulas.test.ts`
Expected: FAIL — `Cannot find module './formulas'`.

- [ ] **Step 4: Implementar as fórmulas** — `src/modules/pacientes/formulas.ts`

```ts
import { arredondar } from '@/lib/numero';

/**
 * Apêndice A da spec (validar com a nutricionista, P-08). Funções puras: o servidor calcula o que
 * grava; o navegador usa as mesmas para a prévia ao vivo. Unidades: kg, cm, anos, mm.
 */
export type Sexo = 'F' | 'M';
export type Protocolo = 'jp3' | 'jp7';

export const DOBRAS = [
  { id: 'peitoral', rotulo: 'Peitoral' },
  { id: 'axilar_media', rotulo: 'Axilar média' },
  { id: 'triceps', rotulo: 'Tríceps' },
  { id: 'subescapular', rotulo: 'Subescapular' },
  { id: 'abdominal', rotulo: 'Abdominal' },
  { id: 'suprailiaca', rotulo: 'Supra-ilíaca' },
  { id: 'coxa', rotulo: 'Coxa' },
] as const;
export type DobraId = (typeof DOBRAS)[number]['id'];

const JP3: Record<Sexo, DobraId[]> = { M: ['peitoral', 'abdominal', 'coxa'], F: ['triceps', 'suprailiaca', 'coxa'] };

export function dobrasDoProtocolo(p: Protocolo, sexo: Sexo): DobraId[] {
  return p === 'jp3' ? JP3[sexo] : DOBRAS.map((d) => d.id);
}

/** IMC = P / (A/100)². */
export function imc(pesoKg: number, alturaCm: number): number {
  const m = alturaCm / 100;
  return pesoKg / (m * m);
}

// D = a − b·S + c·S² − d·I
const COEF_JP: Record<Protocolo, Record<Sexo, readonly [number, number, number, number]>> = {
  jp3: { M: [1.10938, 0.0008267, 0.0000016, 0.0002574], F: [1.0994921, 0.0009929, 0.0000023, 0.0001392] },
  jp7: { M: [1.112, 0.00043499, 0.00000055, 0.00028826], F: [1.097, 0.00046971, 0.00000056, 0.00012828] },
};

export function densidadeJP(p: Protocolo, sexo: Sexo, somaMm: number, idade: number): number {
  const [a, b, c, d] = COEF_JP[p][sexo];
  return a - b * somaMm + c * somaMm * somaMm - d * idade;
}

/** Siri: %G = 495 / D − 450. */
export const siri = (densidade: number): number => 495 / densidade - 450;

export type ResultadoGordura = { ok: true; densidade: number; percGordura: number } | { ok: false; faltando: DobraId[] };

/**
 * %G do protocolo. Faltando dobra, não calcula (US-013 "Dobra faltando"). A densidade gravada tem 5
 * casas e o %G 2, mas o %G sai da densidade SEM arredondar (arredondar antes muda a 2ª casa).
 */
export function calcularGordura(p: Protocolo, sexo: Sexo, idade: number, dobras: Partial<Record<DobraId, number | null>>): ResultadoGordura {
  const necessarias = dobrasDoProtocolo(p, sexo);
  const faltando = necessarias.filter((d) => typeof dobras[d] !== 'number');
  if (faltando.length) return { ok: false, faltando };
  const soma = necessarias.reduce((s, d) => s + (dobras[d] as number), 0);
  const densidade = densidadeJP(p, sexo, soma, idade);
  return { ok: true, densidade: arredondar(densidade, 5), percGordura: arredondar(siri(densidade), 2) };
}

export type FormulaTmb = 'harris_benedict' | 'mifflin' | 'fao_oms';
export const FORMULAS_TMB: readonly { id: FormulaTmb; nome: string }[] = [
  { id: 'harris_benedict', nome: 'Harris-Benedict' },
  { id: 'mifflin', nome: 'Mifflin-St Jeor' },
  { id: 'fao_oms', nome: 'FAO/OMS' },
];
export type DadosTmb = { sexo: Sexo; pesoKg: number; alturaCm: number; idade: number };

/** TMB em kcal, sem arredondar (RN-14 arredonda só na exibição, com `kcal`). */
export function tmb(f: FormulaTmb, d: DadosTmb): number {
  const { sexo, pesoKg: P, alturaCm: A, idade: I } = d;
  switch (f) {
    case 'harris_benedict':
      return sexo === 'M' ? 66.47 + 13.75 * P + 5.003 * A - 6.755 * I : 655.1 + 9.563 * P + 1.85 * A - 4.676 * I;
    case 'mifflin':
      return 10 * P + 6.25 * A - 5 * I + (sexo === 'M' ? 5 : -161);
    case 'fao_oms':
      if (I < 18) throw new RangeError('FAO/OMS não se aplica a menores de 18 anos (RN-17)');
      if (I < 30) return sexo === 'M' ? 15.3 * P + 679 : 14.7 * P + 496;
      if (I < 60) return sexo === 'M' ? 11.6 * P + 879 : 8.7 * P + 829;
      return sexo === 'M' ? 13.5 * P + 487 : 10.5 * P + 596;
  }
}

export const FATOR_MIN = 1;
export const FATOR_MAX = 2.5;

/** GET = TMB × fator de atividade (com a TMB sem arredondar). */
/**
 * GET = TMB × fator, limpo do erro de ponto flutuante em 6 casas: 1302,5 × 1,40 dá 1823,4999999999998 em JS,
 * e o meio para cima (RN-14) sairia 1823 em vez de 1824.
 */
export const gastoTotal = (tmbKcal: number, fator: number): number => arredondar(tmbKcal * fator, 6);

/** RN-14: kcal inteiros, meio para cima — depois de limpar o resíduo de ponto flutuante (6 casas). */
export const kcal = (v: number): number => arredondar(arredondar(v, 6), 0);

export function compararTmb(d: DadosTmb): Record<FormulaTmb, number> {
  return { harris_benedict: tmb('harris_benedict', d), mifflin: tmb('mifflin', d), fao_oms: tmb('fao_oms', d) };
}
```

Run: `pnpm test src/modules/pacientes/formulas.test.ts src/lib/numero.test.ts`
Expected: PASS.

- [ ] **Step 5: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/lib/numero.ts src/lib/numero.test.ts src/modules/pacientes/formulas.ts src/modules/pacientes/formulas.test.ts
git commit -m "feat(pacientes): fórmulas do Apêndice A (IMC, JP3/JP7 + Siri, Harris-Benedict, Mifflin, FAO/OMS) e números em pt-BR (P03-05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Antropometria — registro, validações, IMC e % de gordura (P03-06)

**Files:**
- Create: `drizzle/0021_antropometria.sql` (gerada), `drizzle/0022_rls_antropometria.sql` (custom), `src/modules/pacientes/antropometria-constantes.ts`, `src/modules/pacientes/antropometria.ts`, `src/modules/pacientes/antropometria.test.ts`, `src/app/painel/pacientes/[id]/antropometria/page.tsx`, `src/app/painel/pacientes/[id]/antropometria/actions.ts`, `src/app/painel/pacientes/[id]/antropometria/antropometria-form.tsx`, `src/components/confirmar-botao.tsx` (movido)
- Modify: `src/db/schema/pacientes.ts`, `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts`, `src/app/painel/pacientes/[id]/abas.tsx`, `src/app/admin/page.tsx` (import do botão), `e2e/pacientes.spec.ts`
- Delete: `src/app/admin/confirmar-botao.tsx`

**Interfaces:**
- Consumes: `carregarPacienteParaEscrita`, `idValido`, `MSG_CADASTRO_INCOMPLETO`, `PacienteBloqueadoError`, `PacienteNaoEncontradoError` (Tarefa 1); `dataValida`, `hojeNoFuso`, `idadeEm`, `formatarData` (Tarefa 1); `calcularGordura`, `dobrasDoProtocolo`, `DOBRAS`, `imc`, `type DobraId`, `type Protocolo`, `type Sexo` (Tarefa 6); `decimalEntre`, `decimalOpcionalEntre`, `arredondar`, `formatarDecimal`, `lerDecimal` (Tarefa 6); `auditRead`; `carregarProntuario` (Tarefa 2).
- Produces:
  - Schema: `anthropometry` 🔒 (`imc` gerado no banco, `circunferencias`/`dobras_mm` jsonb, `protocolo`, `densidade`, `perc_gordura`), `type AnthropometryRow`.
  - `@/modules/pacientes/antropometria-constantes` (sem imports, pode ir para o navegador): `CIRCUNFERENCIAS` (`{ id, rotulo }[]`), `type CircunferenciaId`, `MSG_ANTROPO`.
  - `@/modules/pacientes/antropometria` (só servidor; reexporta as constantes): `CIRCUNFERENCIAS`, `type CircunferenciaId`, `MSG_ANTROPO`, `class AntropometriaError { erros: Record<string, string> }`, `type EntradaAntropometria`, `entradaDoFormulario(valores: Record<string, string>): EntradaAntropometria`, `registrarAntropometria(ctx, tenant, patientId, input, deps?): Promise<{ id: string; aviso: string | null }>`, `listarAntropometrias(ctx, patientId, db?): Promise<AnthropometryRow[]>` (mais recente primeiro, audita), `excluirAntropometria(ctx, patientId, id, db?): Promise<boolean>`.
  - `src/components/confirmar-botao.tsx`: `ConfirmarBotao({ mensagem, children, rotulo? })` (`rotulo` = nome acessível).

- [ ] **Step 1: Tabela** — acrescentar ao `src/db/schema/pacientes.ts` (imports: `jsonb`, `numeric` de `drizzle-orm/pg-core`):

```ts
/** US-013. `imc` é calculado pelo banco; densidade e %G, pelo serviço (Apêndice A), só com as dobras completas. */
export const anthropometry = pgTable(
  'anthropometry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    pesoKg: numeric('peso_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    alturaCm: numeric('altura_cm', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    imc: numeric('imc', { precision: 6, scale: 2, mode: 'number' }).generatedAlwaysAs(sql`round(peso_kg / ((altura_cm / 100) * (altura_cm / 100)), 2)`),
    circunferencias: jsonb('circunferencias').$type<Record<string, number>>().notNull().default({}),
    dobrasMm: jsonb('dobras_mm').$type<Record<string, number>>().notNull().default({}),
    protocolo: text('protocolo').notNull().default('nenhum'),
    densidade: numeric('densidade', { precision: 6, scale: 5, mode: 'number' }),
    percGordura: numeric('perc_gordura', { precision: 5, scale: 2, mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('anthropometry_peso_faixa', sql`${t.pesoKg} between 1 and 400`),
    check('anthropometry_altura_faixa', sql`${t.alturaCm} between 30 and 250`),
    check('anthropometry_protocolo_valido', sql`${t.protocolo} in ('jp3', 'jp7', 'nenhum')`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'anthropometry_paciente_fk' }),
    index('anthropometry_paciente_data_idx').on(t.tenantId, t.patientId, t.data),
  ],
);

export type AnthropometryRow = typeof anthropometry.$inferSelect;
```

Run: `pnpm db:generate --name antropometria`
Expected: `drizzle/0021_antropometria.sql` com `"imc" numeric(6, 2) GENERATED ALWAYS AS (round(peso_kg / ((altura_cm / 100) * (altura_cm / 100)), 2)) STORED`, os CHECKs e a FK composta.

Run: `pnpm drizzle-kit generate --custom --name rls_antropometria` e preencher `drizzle/0022_rls_antropometria.sql`:

```sql
SELECT app_enable_tenant_rls('anthropometry');
--> statement-breakpoint
SELECT app_enable_patient_rls('anthropometry');
--> statement-breakpoint
SELECT app_enable_audit('anthropometry', 'antropometria');
```

Em `test/isolamento.test.ts`, acrescentar ao `FABRICAS`:

```ts
  anthropometry: (t, p) => sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${t}, ${p}, '2026-01-01', 70, 175)`,
```

Em `src/modules/plataforma/audit.ts`, acrescentar ao `ENTIDADE_ROTULO`: `antropometria: 'Antropometria',`.

Run: `pnpm test src/db test/isolamento.test.ts`
Expected: PASS.

- [ ] **Step 2: Testes que falham do serviço** — `src/modules/pacientes/antropometria.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { anthropometry, auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { AntropometriaError, entradaDoFormulario, excluirAntropometria, listarAntropometrias, MSG_ANTROPO, registrarAntropometria } from './antropometria';
import { MSG_CADASTRO_INCOMPLETO, PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const entrada = (v: Record<string, string>) => entradaDoFormulario({ data: '2026-09-01', pesoKg: '70', alturaCm: '175', protocolo: 'nenhum', ...v });
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AntropometriaError) return e.erros;
    throw e;
  }
  throw new Error('esperava AntropometriaError');
};

describe('registrarAntropometria (US-013)', () => {
  it('"IMC automático": 70 kg e 175 cm → 22,86 (coluna gerada no banco); circunferências com 1 casa; auditoria "criar"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ circ_cintura: '80,25', circ_quadril: '98' }), deps);
    expect(r.aviso).toBeNull();
    const [a] = await listarAntropometrias(T.ctx, p.id, app.db);
    expect(a).toMatchObject({ id: r.id, pesoKg: 70, alturaCm: 175, imc: 22.86, protocolo: 'nenhum', percGordura: null, circunferencias: { cintura: 80.3, quadril: 98 } });
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, r.id)), app.db);
    expect(log[0]).toMatchObject({ acao: 'criar', entidade: 'antropometria', patientId: p.id, actorUserId: T.nutriId });
  });

  it('JP 3 dobras: homem 30 anos (15, 20, 15) → D 1,06432 e %G 15,08; mulher 35 anos (20, 20, 20) → %G 24,44', async () => {
    const T = await novoTenant(app.db);
    const homem = await novoPaciente(app.db, T.ctx, { sexo: 'M', dataNascimento: '1996-01-15' }); // 30 anos em 01/09/2026
    const r = await registrarAntropometria(T.ctx, T.tenant, homem.id, entrada({ protocolo: 'jp3', dobra_peitoral: '15', dobra_abdominal: '20', dobra_coxa: '15' }), deps);
    const [a] = await listarAntropometrias(T.ctx, homem.id, app.db);
    expect(a).toMatchObject({ id: r.id, densidade: 1.06432, percGordura: 15.08, dobrasMm: { peitoral: 15, abdominal: 20, coxa: 15 } });
    const mulher = await novoPaciente(app.db, T.ctx); // F, 1991-03-10 → 35 anos em 01/09/2026
    await registrarAntropometria(T.ctx, T.tenant, mulher.id, entrada({ protocolo: 'jp3', dobra_triceps: '20', dobra_suprailiaca: '20', dobra_coxa: '20' }), deps);
    expect((await listarAntropometrias(T.ctx, mulher.id, app.db))[0].percGordura).toBe(24.44);
  });

  it('"Dobra faltando": JP 7 sem a axilar média salva o resto, sem %G, com o aviso da spec', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const seis = { dobra_peitoral: '10', dobra_triceps: '12', dobra_subescapular: '14', dobra_abdominal: '20', dobra_suprailiaca: '15', dobra_coxa: '18' };
    const r = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ protocolo: 'jp7', ...seis, circ_braco: '30' }), deps);
    expect(r.aviso).toBe('Preencha as 7 dobras para calcular o % de gordura');
    const [a] = await listarAntropometrias(T.ctx, p.id, app.db);
    expect(a).toMatchObject({ protocolo: 'jp7', percGordura: null, densidade: null, circunferencias: { braco: 30 } });
    expect(Object.keys(a.dobrasMm)).toHaveLength(6);
  });

  it('"Valor fora da faixa" e números digitados do jeito brasileiro (Review Focus 2)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const pesoKg of ['0', '500', '', '7O', '70,5 kg']) {
      expect(await erros(registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ pesoKg }), deps)), pesoKg).toEqual({ pesoKg: 'Peso deve estar entre 1 e 400 kg' });
    }
    expect(await erros(registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ alturaCm: '20', circ_coxa: '2', dobra_coxa: '150' }), deps))).toEqual({
      alturaCm: MSG_ANTROPO.altura,
      circ_coxa: MSG_ANTROPO.circunferencia,
      dobra_coxa: MSG_ANTROPO.dobra,
    });
    expect(await erros(registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '2026-10-02' }), deps))).toEqual({ data: MSG_ANTROPO.futuro });
    expect(await listarAntropometrias(T.ctx, p.id, app.db)).toEqual([]); // nada foi salvo
    await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ pesoKg: ' 70,5 ', alturaCm: '175.0' }), deps);
    expect((await listarAntropometrias(T.ctx, p.id, app.db))[0]).toMatchObject({ pesoKg: 70.5, alturaCm: 175 });
  });

  it('cadastro sem nascimento/sexo (agendamento público) salva as medidas e avisa para completar o cadastro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { origem: 'agendamento_publico', dataNascimento: null, sexo: null });
    const r = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ protocolo: 'jp3', dobra_triceps: '20', dobra_suprailiaca: '20', dobra_coxa: '20' }), deps);
    expect(r.aviso).toBe(MSG_CADASTRO_INCOMPLETO);
  });

  it('paciente de outro tenant: "não encontrado" no serviço e FK composta no banco (Review Focus 4); bloqueado é só leitura', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(registrarAntropometria(A.ctx, A.tenant, deB.id, entrada({}), deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const direto = withTenant(A.ctx, (tx) => tx.execute(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${A.tenantId}, ${deB.id}, '2026-09-01', 70, 175)`), app.db);
    await expect(direto).rejects.toSatisfy((e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code === '23503');
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(registrarAntropometria(A.ctx, A.tenant, bloqueado.id, entrada({}), deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('lista da mais recente para a mais antiga (auditada) e exclui só do próprio paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const antiga = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '2026-06-01' }), deps);
    const nova = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '2026-09-01', pesoKg: '68' }), deps);
    expect((await listarAntropometrias(T.ctx, p.id, app.db)).map((a) => a.id)).toEqual([nova.id, antiga.id]);
    const leitura = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'ler')), app.db);
    expect(leitura.some((l) => l.entidade === 'antropometria' && l.patientId === p.id)).toBe(true);
    expect(await excluirAntropometria(T.ctx, outro.id, antiga.id, app.db)).toBe(false);
    expect(await excluirAntropometria(T.ctx, p.id, antiga.id, app.db)).toBe(true);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(anthropometry).where(eq(anthropometry.patientId, p.id)), app.db)).toHaveLength(1);
  });
});
```

Run: `pnpm test src/modules/pacientes/antropometria.test.ts`
Expected: FAIL — `Cannot find module './antropometria'`.

- [ ] **Step 3: Implementar o serviço** — primeiro as constantes, num arquivo **sem nenhum import** (PF-B1/F8, como `marca-constantes.ts` e, na Tarefa 11, `exames-constantes.ts`): o formulário `'use client'` precisa delas, e importar `antropometria.ts` levaria `@/db/client` (pg, `@/env`), `@/db/tenant` e `audit.ts` para o bundle do navegador — o `pnpm build` quebra. `src/modules/pacientes/antropometria-constantes.ts`:

```ts
/**
 * PF-B1/F8: constantes sem nenhum import, para o formulário `'use client'` da antropometria
 * importá-las sem puxar `antropometria.ts` (pg, env, auditoria) para o navegador.
 */

export const CIRCUNFERENCIAS = [
  { id: 'braco', rotulo: 'Braço' },
  { id: 'cintura', rotulo: 'Cintura' },
  { id: 'abdome', rotulo: 'Abdome' },
  { id: 'quadril', rotulo: 'Quadril' },
  { id: 'coxa', rotulo: 'Coxa' },
  { id: 'panturrilha', rotulo: 'Panturrilha' },
] as const;
export type CircunferenciaId = (typeof CIRCUNFERENCIAS)[number]['id'];

export const MSG_ANTROPO = {
  data: 'Informe a data da avaliação',
  futuro: 'A data não pode ser no futuro',
  peso: 'Peso deve estar entre 1 e 400 kg',
  altura: 'Altura deve estar entre 30 e 250 cm',
  circunferencia: 'Circunferência deve estar entre 5 e 300 cm',
  dobra: 'Dobra deve estar entre 1 e 100 mm',
  dobrasFaltando: (n: number) => `Preencha as ${n} dobras para calcular o % de gordura`,
} as const;
```

`src/modules/pacientes/antropometria.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { anthropometry, type AnthropometryRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar, decimalEntre, decimalOpcionalEntre } from '@/lib/numero';
import { auditRead } from '@/modules/plataforma/audit';
import { CIRCUNFERENCIAS, MSG_ANTROPO, type CircunferenciaId } from './antropometria-constantes';
import { carregarPacienteParaEscrita, idValido, MSG_CADASTRO_INCOMPLETO } from './base';
import { dataValida, hojeNoFuso, idadeEm } from './datas';
import { calcularGordura, DOBRAS, dobrasDoProtocolo, type DobraId, type Protocolo, type Sexo } from './formulas';

export { CIRCUNFERENCIAS, MSG_ANTROPO, type CircunferenciaId } from './antropometria-constantes';

/** Erros por campo: `data`, `pesoKg`, `alturaCm`, `circ_<id>`, `dobra_<id>`. */
export class AntropometriaError extends Error {
  override name = 'AntropometriaError';
  constructor(readonly erros: Record<string, string>) {
    super('Medidas inválidas');
  }
}

export type EntradaAntropometria = {
  data: unknown;
  pesoKg: unknown;
  alturaCm: unknown;
  protocolo: unknown;
  circunferencias: Partial<Record<CircunferenciaId, unknown>>;
  dobras: Partial<Record<DobraId, unknown>>;
};

/** Campos do formulário (`circ_<id>`, `dobra_<id>`) → entrada do serviço. */
export function entradaDoFormulario(v: Record<string, string>): EntradaAntropometria {
  return {
    data: v.data,
    pesoKg: v.pesoKg,
    alturaCm: v.alturaCm,
    protocolo: v.protocolo,
    circunferencias: Object.fromEntries(CIRCUNFERENCIAS.map((c) => [c.id, v[`circ_${c.id}`]])),
    dobras: Object.fromEntries(DOBRAS.map((d) => [d.id, v[`dobra_${d.id}`]])),
  };
}

function campo<T>(schema: z.ZodType<T>, valor: unknown, chave: string, erros: Record<string, string>): T | undefined {
  const r = schema.safeParse(valor);
  if (r.success) return r.data;
  erros[chave] = r.error.issues[0].message;
  return undefined;
}

const PESO = decimalEntre(MSG_ANTROPO.peso, 1, 400);
const ALTURA = decimalEntre(MSG_ANTROPO.altura, 30, 250);
const CIRC = decimalOpcionalEntre(MSG_ANTROPO.circunferencia, 5, 300);
const DOBRA = decimalOpcionalEntre(MSG_ANTROPO.dobra, 1, 100);

/**
 * US-013. Todos os campos são validados antes de gravar (nenhum erro = nada salvo). Com protocolo e as
 * dobras completas, grava densidade e %G (Apêndice A, idade na data da avaliação); faltando dobra ou
 * cadastro, salva as medidas e devolve o aviso.
 */
export async function registrarAntropometria(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  input: EntradaAntropometria,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ id: string; aviso: string | null }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const erros: Record<string, string> = {};
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_ANTROPO.data;
  else if (data > hojeNoFuso(tenant.fuso, now)) erros.data = MSG_ANTROPO.futuro;
  const peso = campo(PESO, input.pesoKg, 'pesoKg', erros);
  const altura = campo(ALTURA, input.alturaCm, 'alturaCm', erros);
  const protocolo: Protocolo | 'nenhum' = input.protocolo === 'jp3' || input.protocolo === 'jp7' ? input.protocolo : 'nenhum';
  const circunferencias: Record<string, number> = {};
  for (const c of CIRCUNFERENCIAS) {
    const v = campo(CIRC, input.circunferencias[c.id], `circ_${c.id}`, erros);
    if (typeof v === 'number') circunferencias[c.id] = arredondar(v, 1);
  }
  const dobras: Partial<Record<DobraId, number>> = {};
  for (const d of DOBRAS) {
    const v = campo(DOBRA, input.dobras[d.id], `dobra_${d.id}`, erros);
    if (typeof v === 'number') dobras[d.id] = arredondar(v, 1);
  }
  if (Object.keys(erros).length || peso === undefined || altura === undefined) throw new AntropometriaError(erros);

  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      let densidade: number | null = null;
      let percGordura: number | null = null;
      let aviso: string | null = null;
      if (protocolo !== 'nenhum') {
        if (!p.dataNascimento || !p.sexo) aviso = MSG_CADASTRO_INCOMPLETO;
        else {
          const sexo = p.sexo as Sexo;
          const r = calcularGordura(protocolo, sexo, idadeEm(p.dataNascimento, data), dobras);
          if (r.ok) ({ densidade, percGordura } = r);
          else aviso = MSG_ANTROPO.dobrasFaltando(dobrasDoProtocolo(protocolo, sexo).length);
        }
      }
      const [row] = await tx
        .insert(anthropometry)
        .values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          data,
          pesoKg: arredondar(peso, 2),
          alturaCm: arredondar(altura, 1),
          circunferencias,
          dobrasMm: dobras,
          protocolo,
          densidade,
          percGordura,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: anthropometry.id });
      return { id: row.id, aviso };
    },
    db,
  );
}

/** Avaliações do paciente, da mais recente para a mais antiga. Leitura de dado de saúde: auditada. */
export async function listarAntropometrias(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<AnthropometryRow[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select()
        .from(anthropometry)
        .where(eq(anthropometry.patientId, patientId))
        .orderBy(desc(anthropometry.data), desc(anthropometry.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

export async function excluirAntropometria(ctx: TenantContext, patientId: string, id: string, db: Db = getDb()): Promise<boolean> {
  if (!idValido(id)) return false;
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const apagadas = await tx
        .delete(anthropometry)
        .where(and(eq(anthropometry.id, id), eq(anthropometry.patientId, patientId)))
        .returning({ id: anthropometry.id });
      return apagadas.length > 0;
    },
    db,
  );
}
```

Run: `pnpm test src/modules/pacientes/antropometria.test.ts`
Expected: PASS.

- [ ] **Step 4: `ConfirmarBotao` compartilhado** — criar `src/components/confirmar-botao.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';

/** Botão de envio que pede confirmação antes (ações que derrubam acesso ou apagam registro). */
export function ConfirmarBotao({ mensagem, children, rotulo }: { mensagem: string; children: ReactNode; rotulo?: string }) {
  return (
    <button className="underline" aria-label={rotulo} onClick={(e) => { if (!window.confirm(mensagem)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
```

Apagar `src/app/admin/confirmar-botao.tsx` e trocar, em `src/app/admin/page.tsx`, `import { ConfirmarBotao } from './confirmar-botao';` por `import { ConfirmarBotao } from '@/components/confirmar-botao';` (o admin continua passando o nome acessível que já passa; conferir com `pnpm test:e2e e2e/plataforma.spec.ts` no Step 7).

- [ ] **Step 5: Tela** — `src/app/painel/pacientes/[id]/antropometria/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AntropometriaError, entradaDoFormulario, excluirAntropometria, registrarAntropometria } from '@/modules/pacientes/antropometria';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type AntropometriaState = {
  erros?: Record<string, string>;
  valores?: Record<string, string>;
  aviso?: string | null;
  ok?: boolean;
  /** Muda a cada resposta: o formulário se remonta com os valores de volta (erro) ou vazio (sucesso). */
  envio?: number;
};

const textos = (f: FormData) => Object.fromEntries([...f.entries()].filter((e): e is [string, string] => typeof e[1] === 'string'));

export async function registrarAntropometriaAction(patientId: string, _prev: AntropometriaState, formData: FormData): Promise<AntropometriaState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/antropometria`);
  const valores = textos(formData);
  try {
    const r = await registrarAntropometria(ctx, tenant, patientId, entradaDoFormulario(valores));
    revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
    return { ok: true, aviso: r.aviso, envio: Date.now() };
  } catch (e) {
    if (e instanceof AntropometriaError) return { erros: e.erros, valores, envio: Date.now() };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores, envio: Date.now() };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
}

export async function excluirAntropometriaAction(patientId: string, id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/antropometria`);
  try {
    await excluirAntropometria(ctx, patientId, id);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}
```

`src/app/painel/pacientes/[id]/antropometria/antropometria-form.tsx`

```tsx
'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import { formatarDecimal, lerDecimal } from '@/lib/numero';
import { CIRCUNFERENCIAS, MSG_ANTROPO } from '@/modules/pacientes/antropometria-constantes'; // nunca de antropometria.ts (servidor)
import { idadeEm } from '@/modules/pacientes/datas';
import { calcularGordura, DOBRAS, dobrasDoProtocolo, imc, type Protocolo, type Sexo } from '@/modules/pacientes/formulas';
import type { AntropometriaState } from './actions';

type Props = {
  acao: (prev: AntropometriaState, formData: FormData) => Promise<AntropometriaState>;
  hoje: string;
  sexo: Sexo | null;
  dataNascimento: string | null;
  somenteLeitura: boolean;
};

export function AntropometriaForm({ acao, hoje, sexo, dataNascimento, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<AntropometriaState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={somenteLeitura}>
        <Campos key={state.envio ?? 0} inicial={state.valores ?? { data: hoje, protocolo: 'nenhum' }} erros={state.erros ?? {}} hoje={hoje} sexo={sexo} dataNascimento={dataNascimento} />
      </fieldset>
      {state.erros?.geral && <p role="alert" className="text-red-700">{state.erros.geral}</p>}
      {state.ok && <p role="status">{state.aviso ? `Avaliação salva. ${state.aviso}` : 'Avaliação salva.'}</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Salvar avaliação</button>}
    </form>
  );
}

function Campos(props: { inicial: Record<string, string>; erros: Record<string, string>; hoje: string; sexo: Sexo | null; dataNascimento: string | null }) {
  const [v, setV] = useState<Record<string, string>>(props.inicial);
  const mudar = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((a) => ({ ...a, [k]: e.target.value }));
  const num = (k: string) => {
    const n = lerDecimal(v[k] ?? '');
    return typeof n === 'number' && !Number.isNaN(n) ? n : null;
  };
  const peso = num('pesoKg');
  const altura = num('alturaCm');
  const protocolo = (v.protocolo ?? 'nenhum') as Protocolo | 'nenhum';
  const visiveis = protocolo === 'nenhum' || !props.sexo ? DOBRAS : DOBRAS.filter((d) => dobrasDoProtocolo(protocolo, props.sexo!).includes(d.id));
  let previaGordura: string | null = null;
  if (protocolo !== 'nenhum' && props.sexo && props.dataNascimento && v.data) {
    const r = calcularGordura(protocolo, props.sexo, idadeEm(props.dataNascimento, v.data), Object.fromEntries(DOBRAS.map((d) => [d.id, num(`dobra_${d.id}`)])));
    previaGordura = r.ok ? `% de gordura: ${formatarDecimal(r.percGordura, 2)}` : MSG_ANTROPO.dobrasFaltando(dobrasDoProtocolo(protocolo, props.sexo).length);
  }
  const entrada = (k: string, rotulo: string, extra: { max?: string; type?: string; inputMode?: 'decimal' } = { inputMode: 'decimal' }) => (
    <div className="space-y-1" key={k}>
      <label htmlFor={k} className="block font-medium">{rotulo}</label>
      <input id={k} name={k} value={v[k] ?? ''} onChange={mudar(k)} className="w-full rounded border p-2" {...extra}
        aria-invalid={props.erros[k] ? true : undefined} aria-describedby={props.erros[k] ? `${k}-erro` : undefined} />
      {props.erros[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{props.erros[k]}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {entrada('data', 'Data da avaliação', { type: 'date', max: props.hoje })}
        {entrada('pesoKg', 'Peso (kg)')}
        {entrada('alturaCm', 'Altura (cm)')}
      </div>
      <p aria-live="polite">{peso && altura && altura >= 30 ? `IMC: ${formatarDecimal(imc(peso, altura), 2)}` : 'IMC: informe peso e altura'}</p>
      <fieldset className="space-y-2">
        <legend className="font-medium">Circunferências (cm)</legend>
        <div className="grid gap-3 sm:grid-cols-3">{CIRCUNFERENCIAS.map((c) => entrada(`circ_${c.id}`, c.rotulo))}</div>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="protocolo" className="block font-medium">Protocolo de dobras</label>
        <select id="protocolo" name="protocolo" value={protocolo} onChange={mudar('protocolo')} className="rounded border p-2">
          <option value="nenhum">Nenhum</option>
          <option value="jp3">JP 3 dobras</option>
          <option value="jp7">JP 7 dobras</option>
        </select>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Dobras cutâneas (mm)</legend>
        <div className="grid gap-3 sm:grid-cols-3">{visiveis.map((d) => entrada(`dobra_${d.id}`, d.rotulo))}</div>
      </fieldset>
      {previaGordura && <p aria-live="polite">{previaGordura}</p>}
    </div>
  );
}
```

`src/app/painel/pacientes/[id]/antropometria/page.tsx`

```tsx
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { formatarDecimal } from '@/lib/numero';
import { listarAntropometrias } from '@/modules/pacientes/antropometria';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import type { Sexo } from '@/modules/pacientes/formulas';
import { carregarProntuario } from '../prontuario';
import { excluirAntropometriaAction, registrarAntropometriaAction } from './actions';
import { AntropometriaForm } from './antropometria-form';

export const dynamic = 'force-dynamic';

const PROTOCOLO: Record<string, string> = { nenhum: '—', jp3: 'JP 3 dobras', jp7: 'JP 7 dobras' };

export default async function AntropometriaPage({ params }: PageProps<'/painel/pacientes/[id]/antropometria'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarAntropometrias(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado';
  return (
    <div className="space-y-8">
      <section aria-labelledby="nova-avaliacao" className="max-w-3xl space-y-3">
        <h2 id="nova-avaliacao" className="text-lg font-semibold">Nova avaliação</h2>
        <AntropometriaForm
          acao={registrarAntropometriaAction.bind(null, paciente.id)}
          hoje={hojeNoFuso(tenant.fuso)}
          sexo={(paciente.sexo as Sexo | null) ?? null}
          dataNascimento={paciente.dataNascimento}
          somenteLeitura={bloqueado}
        />
      </section>
      <section aria-labelledby="avaliacoes" className="space-y-3">
        <h2 id="avaliacoes" className="text-lg font-semibold">Avaliações</h2>
        {lista.length === 0 ? (
          <p>Nenhuma avaliação registrada.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Avaliações antropométricas, da mais recente para a mais antiga</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Peso (kg)</th>
                <th scope="col">Altura (cm)</th>
                <th scope="col">IMC</th>
                <th scope="col">% de gordura</th>
                <th scope="col">Protocolo</th>
                {!bloqueado && <th scope="col"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} className="border-t">
                  <td>{formatarData(a.data)}</td>
                  <td>{formatarDecimal(a.pesoKg, 2)}</td>
                  <td>{formatarDecimal(a.alturaCm, 1)}</td>
                  <td>{a.imc === null ? '—' : formatarDecimal(a.imc, 2)}</td>
                  <td>{a.percGordura === null ? '—' : formatarDecimal(a.percGordura, 2)}</td>
                  <td>{PROTOCOLO[a.protocolo]}</td>
                  {!bloqueado && (
                    <td>
                      <form action={excluirAntropometriaAction.bind(null, paciente.id, a.id)}>
                        <ConfirmarBotao mensagem="Excluir esta avaliação?" rotulo={`Excluir a avaliação de ${formatarData(a.data)}`}>Excluir</ConfirmarBotao>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

Em `src/app/painel/pacientes/[id]/abas.tsx`, acrescentar ao `ABAS`, antes de `historico`: `{ seg: 'antropometria', rotulo: 'Antropometria' },`.

- [ ] **Step 6: E2E** — acrescentar ao `e2e/pacientes.spec.ts`:

```ts
test('antropometria: IMC e % de gordura aparecem ao digitar; JP 3 dobras da mulher de 35 anos = 24,44 (US-013)', async () => {
  await nutri.goto(`${prontuario}/antropometria`);
  await nutri.getByLabel('Data da avaliação').fill('2026-09-01');
  await nutri.getByLabel('Peso (kg)').fill('70');
  await nutri.getByLabel('Altura (cm)').fill('175');
  await expect(nutri.getByText('IMC: 22,86')).toBeVisible();
  await nutri.getByLabel('Protocolo de dobras').selectOption('jp3');
  await nutri.getByLabel('Tríceps').fill('20');
  await nutri.getByLabel('Supra-ilíaca').fill('20');
  await expect(nutri.getByText('Preencha as 3 dobras para calcular o % de gordura')).toBeVisible();
  await nutri.getByLabel('Coxa', { exact: true }).last().fill('20');
  await expect(nutri.getByText('% de gordura: 24,44')).toBeVisible();
  await nutri.getByRole('button', { name: 'Salvar avaliação' }).click();
  await expect(nutri.getByRole('status')).toHaveText('Avaliação salva.');
  const linha = nutri.getByRole('row', { name: /01\/09\/2026/ });
  await expect(linha).toContainText('22,86');
  await expect(linha).toContainText('24,44');
});
```

(Há dois campos "Coxa": o da circunferência e o da dobra; o `.last()` pega o da dobra, que vem depois no formulário.)

- [ ] **Step 7: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`
Expected: tudo verde (inclusive `e2e/plataforma.spec.ts`, que usa os botões com confirmação do admin). Conferir também que `grep -rn "modules/pacientes/antropometria'" src/app --include='*form.tsx'` não acha nada (o formulário cliente só importa `antropometria-constantes`).

```bash
git add src/db/schema/pacientes.ts drizzle/0021_antropometria.sql drizzle/0022_rls_antropometria.sql drizzle/meta test/isolamento.test.ts \
  src/modules/pacientes src/modules/plataforma/audit.ts src/components/confirmar-botao.tsx src/app/admin src/app/painel/pacientes e2e/pacientes.spec.ts
git commit -m "feat(pacientes): antropometria com IMC gerado no banco, JP3/JP7 + Siri, validações e prévia ao vivo (P03-06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Gasto energético — comparar fórmulas, fator de atividade e salvar o cálculo (P03-07)

**Files:**
- Create: `drizzle/0023_gasto_energetico.sql` (gerada), `drizzle/0024_rls_gasto_energetico.sql` (custom), `src/modules/pacientes/gasto-energetico.ts`, `src/modules/pacientes/gasto-energetico.test.ts`, `src/app/painel/pacientes/[id]/gasto-energetico/page.tsx`, `src/app/painel/pacientes/[id]/gasto-energetico/actions.ts`, `src/app/painel/pacientes/[id]/gasto-energetico/calculo-form.tsx`
- Modify: `src/db/schema/pacientes.ts`, `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts`, `src/app/painel/pacientes/[id]/abas.tsx`

**Interfaces:**
- Consumes: `carregarPacienteParaEscrita`, `idValido`, `MSG_CADASTRO_INCOMPLETO` (Tarefa 1); `hojeNoFuso`, `idadeEm` (Tarefa 1); `tmb`, `gastoTotal`, `kcal`, `compararTmb`, `FORMULAS_TMB`, `FATOR_MIN`, `FATOR_MAX`, `type FormulaTmb`, `type Sexo` (Tarefa 6); `decimalEntre`, `arredondar`, `formatarDecimal`, `lerDecimal` (Tarefa 6); `MSG_ANTROPO` (Tarefa 7); `anthropometry` (Tarefa 7); `auditRead`; `formatarDataHora`; `carregarProntuario`.
- Produces:
  - Schema: `energyCalcs` 🔒 (`formula`, `peso_kg`, `altura_cm`, `idade`, `sexo`, `fator_atividade`, `tmb`, `get`), `type EnergyCalcRow`. O P04-05 liga `meal_plans.energy_calc_id` a ela ("Usar como meta do plano").
  - `@/modules/pacientes/gasto-energetico`: `MSG_GASTO`, `class GastoError { erros }`, `salvarCalculo(ctx, tenant, patientId, input, deps?): Promise<{ id; tmb: number; get: number }>` (kcal inteiros), `listarCalculos(ctx, patientId, db?): Promise<EnergyCalcRow[]>` (audita), `medidasRecentes(ctx, patientId, db?): Promise<{ pesoKg: number | null; alturaCm: number | null }>` (audita).

- [ ] **Step 1: Tabela** — acrescentar ao `src/db/schema/pacientes.ts` (import: `integer`):

```ts
/** US-014. Guarda o que entrou na conta (peso, altura, idade, sexo) e o resultado sem arredondar; a tela mostra kcal inteiros. */
export const energyCalcs = pgTable(
  'energy_calcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    formula: text('formula').notNull(),
    pesoKg: numeric('peso_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    alturaCm: numeric('altura_cm', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    idade: integer('idade').notNull(),
    sexo: text('sexo').notNull(),
    fatorAtividade: numeric('fator_atividade', { precision: 3, scale: 2, mode: 'number' }).notNull(),
    // 6 casas: o mesmo valor que as fórmulas devolvem; com 2 casas, 1500,4951 viraria 1500,50 e a lista
    // mostraria 1501 onde a tela de sucesso mostrou 1500 (arredondamento duplo, RN-14)
    tmb: numeric('tmb', { precision: 12, scale: 6, mode: 'number' }).notNull(),
    get: numeric('get', { precision: 12, scale: 6, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('energy_calcs_formula_valida', sql`${t.formula} in ('harris_benedict', 'mifflin', 'fao_oms')`),
    check('energy_calcs_fator_faixa', sql`${t.fatorAtividade} between 1.00 and 2.50`),
    check('energy_calcs_sexo_valido', sql`${t.sexo} in ('F', 'M')`),
    check('energy_calcs_idade_adulto', sql`${t.idade} >= 18`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'energy_calcs_paciente_fk' }),
    index('energy_calcs_paciente_idx').on(t.tenantId, t.patientId, t.createdAt),
  ],
);

export type EnergyCalcRow = typeof energyCalcs.$inferSelect;
```

Run: `pnpm db:generate --name gasto_energetico` → `drizzle/0023_gasto_energetico.sql`.

Run: `pnpm drizzle-kit generate --custom --name rls_gasto_energetico` e preencher `drizzle/0024_rls_gasto_energetico.sql`:

```sql
SELECT app_enable_tenant_rls('energy_calcs');
--> statement-breakpoint
SELECT app_enable_patient_rls('energy_calcs');
--> statement-breakpoint
SELECT app_enable_audit('energy_calcs', 'gasto_energetico');
```

`test/isolamento.test.ts`, no `FABRICAS`:

```ts
  energy_calcs: (t, p) =>
    sql`insert into energy_calcs (tenant_id, patient_id, formula, peso_kg, altura_cm, idade, sexo, fator_atividade, tmb, get)
        values (${t}, ${p}, 'mifflin', 60, 165, 35, 'F', 1.55, 1295.25, 2007.64)`,
```

`src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `gasto_energetico: 'Gasto energético',`.

Run: `pnpm test src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 2: Testes que falham** — `src/modules/pacientes/gasto-energetico.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { registrarAntropometria, entradaDoFormulario } from './antropometria';
import { MSG_CADASTRO_INCOMPLETO, PacienteNaoEncontradoError } from './base';
import { GastoError, listarCalculos, medidasRecentes, MSG_GASTO, salvarCalculo } from './gasto-energetico';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof GastoError) return e.erros;
    throw e;
  }
  throw new Error('esperava GastoError');
};

describe('gasto energético (US-014, RN-14)', () => {
  it('"Mifflin-St Jeor": paciente F, 35 anos, última antropometria 60 kg / 165 cm, fator 1,55 → TMB 1295, GET 2008', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx); // F, 1991-03-10 → 35 anos em 01/10/2026
    await registrarAntropometria(T.ctx, T.tenant, p.id, entradaDoFormulario({ data: '2026-09-15', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }), deps);
    expect(await medidasRecentes(T.ctx, p.id, app.db)).toEqual({ pesoKg: 60, alturaCm: 165 });
    const r = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    expect(r).toMatchObject({ tmb: 1295, get: 2008 });
    const [c] = await listarCalculos(T.ctx, p.id, app.db);
    expect(c).toMatchObject({ id: r.id, formula: 'mifflin', idade: 35, sexo: 'F', fatorAtividade: 1.55, tmb: 1295.25, get: 2007.6375 }); // sem arredondar (6 casas)
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, r.id)), app.db);
    expect(log[0]).toMatchObject({ acao: 'criar', entidade: 'gasto_energetico', actorUserId: T.nutriId });
  });

  it('"Fator inválido": 3,0 → "Fator de atividade deve estar entre 1,00 e 2,50"; peso e fórmula também são conferidos', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await erros(salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '3,0' }, deps))).toEqual({
      fator: 'Fator de atividade deve estar entre 1,00 e 2,50',
    });
    // Review Focus 2 também no fator: lixo digitado vira a mensagem do campo, nunca NaN gravado
    for (const fator of ['1,5O', '', 'abc', '1,55 x']) {
      expect(await erros(salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator }, deps)), fator).toEqual({
        fator: 'Fator de atividade deve estar entre 1,00 e 2,50',
      });
    }
    expect(await erros(salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'x', pesoKg: '0', alturaCm: '165', fator: '1,2' }, deps))).toEqual({
      formula: MSG_GASTO.formula,
      pesoKg: 'Peso deve estar entre 1 e 400 kg',
    });
    expect(await listarCalculos(T.ctx, p.id, app.db)).toEqual([]);
  });

  it('idade = anos completos na data do cálculo, no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { dataNascimento: '1991-10-02' }); // faz 35 em 02/10/2026
    await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'fao_oms', pesoKg: '60', alturaCm: '165', fator: '1' }, { db: app.db, now: new Date('2026-10-02T02:00:00Z') }); // 01/10 23h em SP
    await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'fao_oms', pesoKg: '60', alturaCm: '165', fator: '1' }, { db: app.db, now: new Date('2026-10-02T12:00:00Z') });
    expect((await listarCalculos(T.ctx, p.id, app.db)).map((c) => c.idade).sort()).toEqual([34, 35]);
  });

  it('cadastro incompleto não calcula; paciente de outro tenant = não encontrado', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const semCadastro = await novoPaciente(app.db, A.ctx, { origem: 'agendamento_publico', dataNascimento: null, sexo: null });
    expect(await erros(salvarCalculo(A.ctx, A.tenant, semCadastro.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,2' }, deps))).toEqual({
      geral: MSG_CADASTRO_INCOMPLETO,
    });
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(salvarCalculo(A.ctx, A.tenant, deB.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,2' }, deps)).rejects.toBeInstanceOf(
      PacienteNaoEncontradoError,
    );
    expect(await medidasRecentes(A.ctx, deB.id, app.db)).toEqual({ pesoKg: null, alturaCm: null });
  });
});
```

Run: `pnpm test src/modules/pacientes/gasto-energetico.test.ts`
Expected: FAIL — `Cannot find module './gasto-energetico'`.

- [ ] **Step 3: Implementar** — `src/modules/pacientes/gasto-energetico.ts`

```ts
import { desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { anthropometry, energyCalcs, type EnergyCalcRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar, decimalEntre } from '@/lib/numero';
import { auditRead } from '@/modules/plataforma/audit';
import { MSG_ANTROPO } from './antropometria';
import { carregarPacienteParaEscrita, idValido, MSG_CADASTRO_INCOMPLETO } from './base';
import { hojeNoFuso, idadeEm } from './datas';
import { FATOR_MAX, FATOR_MIN, FORMULAS_TMB, gastoTotal, kcal, tmb, type FormulaTmb, type Sexo } from './formulas';

export const MSG_GASTO = {
  fator: 'Fator de atividade deve estar entre 1,00 e 2,50',
  formula: 'Escolha a fórmula',
} as const;

export class GastoError extends Error {
  override name = 'GastoError';
  constructor(readonly erros: Record<string, string>) {
    super('Cálculo inválido');
  }
}

const PESO = decimalEntre(MSG_ANTROPO.peso, 1, 400);
const ALTURA = decimalEntre(MSG_ANTROPO.altura, 30, 250);
const FATOR = decimalEntre(MSG_GASTO.fator, FATOR_MIN, FATOR_MAX);

/**
 * US-014. A idade é a do dia do cálculo no fuso do tenant (RN-14); sexo e nascimento vêm do cadastro.
 * Grava o resultado sem arredondar (2 casas); devolve kcal inteiros, como a tela mostra.
 */
export async function salvarCalculo(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  input: { formula: unknown; pesoKg: unknown; alturaCm: unknown; fator: unknown },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ id: string; tmb: number; get: number }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const erros: Record<string, string> = {};
  const formula = FORMULAS_TMB.some((f) => f.id === input.formula) ? (input.formula as FormulaTmb) : null;
  if (!formula) erros.formula = MSG_GASTO.formula;
  const peso = PESO.safeParse(input.pesoKg);
  if (!peso.success) erros.pesoKg = peso.error.issues[0].message;
  const altura = ALTURA.safeParse(input.alturaCm);
  if (!altura.success) erros.alturaCm = altura.error.issues[0].message;
  const fator = FATOR.safeParse(input.fator);
  if (!fator.success) erros.fator = fator.error.issues[0].message;
  if (!formula || !peso.success || !altura.success || !fator.success) throw new GastoError(erros);

  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (!p.dataNascimento || !p.sexo) throw new GastoError({ geral: MSG_CADASTRO_INCOMPLETO });
      const dados = { sexo: p.sexo as Sexo, pesoKg: arredondar(peso.data, 2), alturaCm: arredondar(altura.data, 1), idade: idadeEm(p.dataNascimento, hojeNoFuso(tenant.fuso, now)) };
      const fatorAtividade = arredondar(fator.data, 2);
      const t = tmb(formula, dados);
      const g = gastoTotal(t, fatorAtividade);
      const [row] = await tx
        .insert(energyCalcs)
        .values({ tenantId: ctx.tenantId, patientId: p.id, formula, ...dados, fatorAtividade, tmb: arredondar(t, 6), get: arredondar(g, 6), createdAt: now })
        .returning({ id: energyCalcs.id });
      return { id: row.id, tmb: kcal(t), get: kcal(g) };
    },
    db,
  );
}

export async function listarCalculos(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<EnergyCalcRow[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(energyCalcs).where(eq(energyCalcs.patientId, patientId)).orderBy(desc(energyCalcs.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'gasto_energetico', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

/** Peso e altura da avaliação mais recente, para preencher o cálculo (US-014 "com última antropometria"). */
export async function medidasRecentes(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<{ pesoKg: number | null; alturaCm: number | null }> {
  if (!idValido(patientId)) return { pesoKg: null, alturaCm: null };
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx
        .select({ pesoKg: anthropometry.pesoKg, alturaCm: anthropometry.alturaCm })
        .from(anthropometry)
        .where(eq(anthropometry.patientId, patientId))
        .orderBy(desc(anthropometry.data), desc(anthropometry.createdAt))
        .limit(1);
      if (!a) return { pesoKg: null, alturaCm: null };
      await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
      return a;
    },
    db,
  );
}
```

Run: `pnpm test src/modules/pacientes/gasto-energetico.test.ts`
Expected: PASS.

- [ ] **Step 4: Tela** — `src/app/painel/pacientes/[id]/gasto-energetico/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { GastoError, salvarCalculo } from '@/modules/pacientes/gasto-energetico';

export type CalculoState = { erros?: Record<string, string>; ok?: { tmb: number; get: number } };

export async function salvarCalculoAction(patientId: string, _prev: CalculoState, formData: FormData): Promise<CalculoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/gasto-energetico`);
  try {
    const r = await salvarCalculo(ctx, tenant, patientId, {
      formula: formData.get('formula'),
      pesoKg: formData.get('pesoKg'),
      alturaCm: formData.get('alturaCm'),
      fator: formData.get('fator'),
    });
    revalidatePath(`/painel/pacientes/${patientId}/gasto-energetico`);
    return { ok: { tmb: r.tmb, get: r.get } };
  } catch (e) {
    if (e instanceof GastoError) return { erros: e.erros };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message } };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
}
```

`src/app/painel/pacientes/[id]/gasto-energetico/calculo-form.tsx`

```tsx
'use client';

import { useActionState, useState } from 'react';
import { formatarDecimal, lerDecimal } from '@/lib/numero';
import { compararTmb, FATOR_MAX, FATOR_MIN, FORMULAS_TMB, gastoTotal, kcal, type FormulaTmb, type Sexo } from '@/modules/pacientes/formulas';
import type { CalculoState } from './actions';

type Props = {
  acao: (prev: CalculoState, formData: FormData) => Promise<CalculoState>;
  sexo: Sexo;
  idade: number;
  pesoKg: number | null;
  alturaCm: number | null;
};

const valido = (n: number | null, min: number, max: number): n is number => typeof n === 'number' && !Number.isNaN(n) && n >= min && n <= max;

/** US-014 "Comparar fórmulas": as 3 TMB lado a lado enquanto digita; salva a escolhida com o fator. */
export function CalculoForm({ acao, sexo, idade, pesoKg, alturaCm }: Props) {
  const [state, action, pendente] = useActionState<CalculoState, FormData>(acao, {});
  const [peso, setPeso] = useState(pesoKg === null ? '' : formatarDecimal(pesoKg, 2)); // peso é numeric(5,2): 60,25 não pode virar 60,3 na TMB
  const [altura, setAltura] = useState(alturaCm === null ? '' : formatarDecimal(alturaCm, 1));
  const [fator, setFator] = useState('1,20');
  const [formula, setFormula] = useState<FormulaTmb>('mifflin');
  const p = lerDecimal(peso);
  const a = lerDecimal(altura);
  const f = lerDecimal(fator);
  const comparacao = valido(p, 1, 400) && valido(a, 30, 250) ? compararTmb({ sexo, pesoKg: p, alturaCm: a, idade }) : null;
  const e = state.erros ?? {};
  const erroDe = (k: string) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['pesoKg', 'Peso (kg)', peso, setPeso],
            ['alturaCm', 'Altura (cm)', altura, setAltura],
            ['fator', 'Fator de atividade', fator, setFator],
          ] as const
        ).map(([k, rotulo, valor, set]) => (
          <div key={k} className="space-y-1">
            <label htmlFor={k} className="block font-medium">{rotulo}</label>
            <input id={k} name={k} inputMode="decimal" value={valor} onChange={(ev) => set(ev.target.value)} className="w-full rounded border p-2" {...erroDe(k)} />
            {e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{e[k]}</p>}
          </div>
        ))}
      </div>
      <p className="text-sm text-zinc-700">{`Idade usada: ${idade} anos. Fator de ${formatarDecimal(FATOR_MIN, 2)} a ${formatarDecimal(FATOR_MAX, 2)}.`}</p>
      <fieldset>
        <legend className="font-medium">Fórmula</legend>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Comparação das fórmulas de taxa metabólica basal</caption>
          <thead>
            <tr>
              <th scope="col">Usar</th>
              <th scope="col">Fórmula</th>
              <th scope="col">TMB (kcal)</th>
              <th scope="col">GET (kcal)</th>
            </tr>
          </thead>
          <tbody>
            {FORMULAS_TMB.map((fo) => {
              const t = comparacao?.[fo.id];
              return (
                <tr key={fo.id} className="border-t">
                  <td>
                    <input id={`formula-${fo.id}`} name="formula" type="radio" value={fo.id} checked={formula === fo.id} onChange={() => setFormula(fo.id)} />
                  </td>
                  <td><label htmlFor={`formula-${fo.id}`}>{fo.nome}</label></td>
                  <td>{t === undefined ? '—' : String(kcal(t))}</td>
                  <td>{t === undefined || !valido(f, FATOR_MIN, FATOR_MAX) ? '—' : String(kcal(gastoTotal(t, f)))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {e.formula && <p role="alert" className="text-sm text-red-700">{e.formula}</p>}
      </fieldset>
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      {state.ok && <p role="status">{`Cálculo salvo: TMB ${state.ok.tmb} kcal, GET ${state.ok.get} kcal.`}</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Salvar cálculo</button>
    </form>
  );
}
```

`src/app/painel/pacientes/[id]/gasto-energetico/page.tsx`

```tsx
import { formatarDecimal } from '@/lib/numero';
import { MSG_CADASTRO_INCOMPLETO } from '@/modules/pacientes/base';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { FORMULAS_TMB, kcal, type Sexo } from '@/modules/pacientes/formulas';
import { listarCalculos, medidasRecentes } from '@/modules/pacientes/gasto-energetico';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../prontuario';
import { salvarCalculoAction } from './actions';
import { CalculoForm } from './calculo-form';

export const dynamic = 'force-dynamic';

const NOME = Object.fromEntries(FORMULAS_TMB.map((f) => [f.id, f.nome]));

export default async function GastoEnergeticoPage({ params }: PageProps<'/painel/pacientes/[id]/gasto-energetico'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const [medidas, calculos] = await Promise.all([medidasRecentes(ctx, paciente.id), listarCalculos(ctx, paciente.id)]);
  const podeCalcular = !!paciente.dataNascimento && !!paciente.sexo && paciente.status !== 'bloqueado';
  return (
    <div className="space-y-8">
      <section aria-labelledby="novo-calculo" className="max-w-3xl space-y-3">
        <h2 id="novo-calculo" className="text-lg font-semibold">Calcular gasto energético</h2>
        {!paciente.dataNascimento || !paciente.sexo ? (
          <p role="status">{MSG_CADASTRO_INCOMPLETO}</p>
        ) : podeCalcular ? (
          <CalculoForm
            acao={salvarCalculoAction.bind(null, paciente.id)}
            sexo={paciente.sexo as Sexo}
            idade={idadeEm(paciente.dataNascimento, hojeNoFuso(tenant.fuso))}
            pesoKg={medidas.pesoKg}
            alturaCm={medidas.alturaCm}
          />
        ) : null}
      </section>
      <section aria-labelledby="calculos" className="space-y-3">
        <h2 id="calculos" className="text-lg font-semibold">Cálculos salvos</h2>
        {calculos.length === 0 ? (
          <p>Nenhum cálculo salvo.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Cálculos de gasto energético, do mais recente para o mais antigo</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Fórmula</th>
                <th scope="col">Peso / altura</th>
                <th scope="col">Idade</th>
                <th scope="col">Fator</th>
                <th scope="col">TMB (kcal)</th>
                <th scope="col">GET (kcal)</th>
              </tr>
            </thead>
            <tbody>
              {calculos.map((c) => (
                <tr key={c.id} className="border-t">
                  <td>{formatarDataHora(c.createdAt, tenant.fuso)}</td>
                  <td>{NOME[c.formula]}</td>
                  <td>{`${formatarDecimal(c.pesoKg, 2)} kg / ${formatarDecimal(c.alturaCm, 1)} cm`}</td>
                  <td>{c.idade}</td>
                  <td>{formatarDecimal(c.fatorAtividade, 2)}</td>
                  <td>{kcal(c.tmb)}</td>
                  <td>{kcal(c.get)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

Em `abas.tsx`, acrescentar antes de `historico`: `{ seg: 'gasto-energetico', rotulo: 'Gasto energético' },`.

- [ ] **Step 5: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/db/schema/pacientes.ts drizzle/0023_gasto_energetico.sql drizzle/0024_rls_gasto_energetico.sql drizzle/meta test/isolamento.test.ts \
  src/modules/pacientes src/modules/plataforma/audit.ts src/app/painel/pacientes
git commit -m "feat(pacientes): gasto energético com as 3 fórmulas lado a lado, fator 1,00–2,50 e cálculo salvo (P03-07)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Anamnese — modelos editáveis (7 tipos), modelo padrão e preenchimento com snapshot (P03-04)

**Files:**
- Create: `src/modules/pacientes/anamnese-tipos.ts`, `src/modules/pacientes/anamnese-tipos.test.ts`, `src/modules/pacientes/anamnese-padrao.ts`, `src/modules/pacientes/anamnese.ts`, `src/modules/pacientes/anamnese.test.ts`, `drizzle/0025_anamnese.sql` (gerada), `drizzle/0026_rls_anamnese.sql` (custom), `src/app/painel/anamnese/modelos/page.tsx`, `src/app/painel/anamnese/modelos/novo/page.tsx`, `src/app/painel/anamnese/modelos/[modeloId]/page.tsx`, `src/app/painel/anamnese/modelos/actions.ts`, `src/app/painel/anamnese/modelos/modelo-editor.tsx`, `src/app/painel/pacientes/[id]/anamnese/page.tsx`, `src/app/painel/pacientes/[id]/anamnese/nova/page.tsx`, `src/app/painel/pacientes/[id]/anamnese/[anamneseId]/page.tsx`, `src/app/painel/pacientes/[id]/anamnese/actions.ts`, `src/app/painel/pacientes/[id]/anamnese/anamnese-form.tsx`
- Modify: `src/db/schema/pacientes.ts`, `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts`, `src/app/painel/pacientes/[id]/abas.tsx`, `src/app/painel/cabecalho.tsx`, `e2e/pacientes.spec.ts`

**Interfaces:**
- Consumes: `carregarPacienteParaEscrita`, `idValido`, `PacienteBloqueadoError`, `PacienteNaoEncontradoError` (Tarefa 1); `dataValida`, `hojeNoFuso`, `formatarData` (Tarefa 1); `lerDecimal` (Tarefa 6); `auditRead`; `ConfirmarBotao` (Tarefa 7); `carregarProntuario`; `requireNutri`.
- Produces:
  - `@/modules/pacientes/anamnese-tipos` (puro, também no navegador): `TIPOS_PERGUNTA` (`{ id, rotulo }[]`), `type TipoPergunta`, `type Pergunta = { id; tipo; rotulo; obrigatoria; unidade?; opcoes? }`, `type ModeloSchema = { perguntas: Pergunta[] }`, `type SnapshotModelo = { nome: string; perguntas: Pergunta[] }`, `type Resposta = string | number | boolean | string[]`, `MSG_ANAMNESE`, `validarModelo(input): { ok: true; nome; perguntas } | { ok: false; erros }`, `validarRespostas(perguntas, bruto): { ok: true; respostas } | { ok: false; erros }`, `respostasDoFormulario(perguntas, f: FormData): Record<string, string | string[]>`, `respostaParaCampo(r: Resposta | undefined): string | string[]`.
  - `@/modules/pacientes/anamnese-padrao`: `NOME_MODELO_PADRAO = 'Anamnese geral'`, `modeloPadrao(): { nome; schema: ModeloSchema }`.
  - Schema: `anamnesisTemplates` 🔒 (`schema` jsonb, `padrao`, `arquivado_em`), `anamneses` 🔒 (`template_id`, `template_snapshot`, `respostas`, `data`).
  - `@/modules/pacientes/anamnese`: `class AnamneseError { erros }`, `type ModeloResumo`, `garantirModeloPadrao(tx, tenantId)`, `listarModelos(ctx, db?)`, `buscarModelo(ctx, id, db?)`, `salvarModelo(ctx, id | null, input, db?): Promise<string>`, `arquivarModelo(ctx, id, db?)`, `preencherAnamnese(ctx, tenant, patientId, templateId, bruto, deps?): Promise<string>`, `atualizarAnamnese(ctx, patientId, anamneseId, bruto, db?)`, `listarAnamneses(ctx, patientId, db?)`, `buscarAnamnese(ctx, patientId, anamneseId, db?)`.

- [ ] **Step 1: Testes que falham das regras puras** — `src/modules/pacientes/anamnese-tipos.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { MSG_ANAMNESE, respostaParaCampo, respostasDoFormulario, validarModelo, validarRespostas, type Pergunta } from './anamnese-tipos';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const P: Pergunta[] = [
  { id: id(1), tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: true },
  { id: id(2), tipo: 'numero', rotulo: 'Consumo de água', obrigatoria: false, unidade: 'litros por dia' },
  { id: id(3), tipo: 'sim_nao', rotulo: 'Fuma?', obrigatoria: false },
  { id: id(4), tipo: 'escolha_unica', rotulo: 'Intestino', obrigatoria: false, opcoes: ['Regular', 'Constipação'] },
  { id: id(5), tipo: 'multipla_escolha', rotulo: 'Refeições', obrigatoria: false, opcoes: ['Café', 'Almoço', 'Jantar'] },
  { id: id(6), tipo: 'data', rotulo: 'Último exame', obrigatoria: false },
  { id: id(7), tipo: 'texto_longo', rotulo: 'Histórico', obrigatoria: false },
];

describe('validarModelo (US-012)', () => {
  it('aceita os 7 tipos; tira espaços, opções vazias/repetidas e unidade de quem não é número', () => {
    const r = validarModelo({
      nome: '  Retorno ',
      perguntas: [
        ...P.map((p) => ({ ...p, rotulo: ` ${p.rotulo} ` })),
        { id: 'lixo', tipo: 'texto_curto', rotulo: 'Sem id válido', obrigatoria: false, unidade: 'kg' },
        { id: id(4), tipo: 'escolha_unica', rotulo: 'Id repetido', obrigatoria: false, opcoes: [' A ', 'A', '', 'B'] },
      ],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.nome).toBe('Retorno');
    expect(r.perguntas).toHaveLength(9);
    expect(r.perguntas[0].rotulo).toBe('Alergias');
    expect(r.perguntas[7]).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), tipo: 'texto_curto', rotulo: 'Sem id válido', obrigatoria: false });
    expect(r.perguntas[8].opcoes).toEqual(['A', 'B']);
    expect(new Set(r.perguntas.map((p) => p.id)).size).toBe(9);
  });
  it('erros por campo: nome, texto da pergunta, menos de 2 opções, nenhuma pergunta, tipo inválido', () => {
    expect(validarModelo({ nome: '', perguntas: [] })).toEqual({ ok: false, erros: { nome: MSG_ANAMNESE.nomeModelo, perguntas: MSG_ANAMNESE.semPerguntas } });
    const r = validarModelo({
      nome: 'X',
      perguntas: [
        { tipo: 'texto_curto', rotulo: '  ', obrigatoria: false },
        { tipo: 'escolha_unica', rotulo: 'Uma só', obrigatoria: false, opcoes: ['A'] },
        { tipo: 'desenho', rotulo: 'Tipo errado', obrigatoria: false },
      ],
    });
    expect(r).toEqual({ ok: false, erros: { pergunta_0: MSG_ANAMNESE.rotulo, pergunta_1: MSG_ANAMNESE.opcoes, pergunta_2: MSG_ANAMNESE.tipo } });
  });
  it('acima dos limites dá erro, nunca corta em silêncio: 101 perguntas, 31 opções, opção com 101 caracteres', () => {
    const q = (i: number) => ({ tipo: 'texto_curto', rotulo: `P${i}`, obrigatoria: false });
    expect(validarModelo({ nome: 'X', perguntas: Array.from({ length: 101 }, (_, i) => q(i)) })).toEqual({ ok: false, erros: { perguntas: MSG_ANAMNESE.muitasPerguntas } });
    const opcoes = (o: string[]) => validarModelo({ nome: 'X', perguntas: [{ tipo: 'multipla_escolha', rotulo: 'M', obrigatoria: false, opcoes: o }] });
    expect(opcoes(Array.from({ length: 31 }, (_, i) => `op${i}`))).toEqual({ ok: false, erros: { pergunta_0: MSG_ANAMNESE.muitasOpcoes } });
    expect(opcoes(['A', 'x'.repeat(101)])).toEqual({ ok: false, erros: { pergunta_0: MSG_ANAMNESE.muitasOpcoes } });
    expect(opcoes(Array.from({ length: 30 }, (_, i) => `op${i}`)).ok).toBe(true);
  });
});

describe('validarRespostas', () => {
  it('"Obrigatória não preenchida": "Responda: Alergias" (e nada mais é aceito)', () => {
    expect(validarRespostas(P, {})).toEqual({ ok: false, erros: { [id(1)]: 'Responda: Alergias' } });
    expect(validarRespostas(P, { [id(1)]: '   ' })).toEqual({ ok: false, erros: { [id(1)]: 'Responda: Alergias' } });
  });
  it('converte cada tipo; vazio some; valor fora das opções, número ou data inválidos → "Resposta inválida: <pergunta>"', () => {
    const ok = validarRespostas(P, {
      [id(1)]: ' Lactose ',
      [id(2)]: '1,5',
      [id(3)]: 'nao',
      [id(4)]: 'Regular',
      [id(5)]: ['Café', 'Jantar'],
      [id(6)]: '2026-08-10',
      [id(7)]: '',
    });
    expect(ok).toEqual({ ok: true, respostas: { [id(1)]: 'Lactose', [id(2)]: 1.5, [id(3)]: false, [id(4)]: 'Regular', [id(5)]: ['Café', 'Jantar'], [id(6)]: '2026-08-10' } });
    const ruim = validarRespostas(P, { [id(1)]: 'x', [id(2)]: '1,5 L', [id(4)]: 'Outra', [id(5)]: ['Ceia'], [id(6)]: '2026-02-30', [id(3)]: 'talvez' });
    expect(ruim).toEqual({
      ok: false,
      erros: {
        [id(2)]: 'Resposta inválida: Consumo de água',
        [id(3)]: 'Resposta inválida: Fuma?',
        [id(4)]: 'Resposta inválida: Intestino',
        [id(5)]: 'Resposta inválida: Refeições',
        [id(6)]: 'Resposta inválida: Último exame',
      },
    });
  });
  it('lê o FormData (r_<id>, múltipla escolha com getAll) e volta a resposta para o campo', () => {
    const f = new FormData();
    f.set(`r_${id(1)}`, 'Lactose');
    f.append(`r_${id(5)}`, 'Café');
    f.append(`r_${id(5)}`, 'Jantar');
    expect(respostasDoFormulario(P, f)).toMatchObject({ [id(1)]: 'Lactose', [id(5)]: ['Café', 'Jantar'], [id(2)]: '' });
    expect(respostaParaCampo(1.5)).toBe('1,5');
    expect(respostaParaCampo(true)).toBe('sim');
    expect(respostaParaCampo(['A'])).toEqual(['A']);
    expect(respostaParaCampo(undefined)).toBe('');
  });
});
```

Run: `pnpm test src/modules/pacientes/anamnese-tipos.test.ts`
Expected: FAIL — `Cannot find module './anamnese-tipos'`.

- [ ] **Step 2: Implementar as regras puras** — `src/modules/pacientes/anamnese-tipos.ts`

```ts
import { lerDecimal } from '@/lib/numero';
import { dataValida } from './datas';

/** US-012: os 7 tipos de pergunta. Arquivo puro: o editor de modelos e o formulário usam no navegador. */
export const TIPOS_PERGUNTA = [
  { id: 'texto_curto', rotulo: 'Texto curto' },
  { id: 'texto_longo', rotulo: 'Texto longo' },
  { id: 'numero', rotulo: 'Número' },
  { id: 'sim_nao', rotulo: 'Sim/não' },
  { id: 'escolha_unica', rotulo: 'Escolha única' },
  { id: 'multipla_escolha', rotulo: 'Múltipla escolha' },
  { id: 'data', rotulo: 'Data' },
] as const;
export type TipoPergunta = (typeof TIPOS_PERGUNTA)[number]['id'];

export type Pergunta = { id: string; tipo: TipoPergunta; rotulo: string; obrigatoria: boolean; unidade?: string; opcoes?: string[] };
export type ModeloSchema = { perguntas: Pergunta[] };
/** Cópia do modelo no momento do preenchimento (US-012 "Snapshot do modelo"). */
export type SnapshotModelo = { nome: string; perguntas: Pergunta[] };
export type Resposta = string | number | boolean | string[];

export const MSG_ANAMNESE = {
  nomeModelo: 'Informe o nome do modelo',
  semPerguntas: 'Inclua pelo menos uma pergunta',
  rotulo: 'Informe o texto da pergunta',
  opcoes: 'Informe pelo menos 2 opções',
  tipo: 'Escolha o tipo da pergunta',
  muitasPerguntas: 'Use no máximo 100 perguntas',
  muitasOpcoes: 'Use no máximo 30 opções, com até 100 caracteres cada',
  modeloNaoEncontrado: 'Modelo de anamnese não encontrado.',
  responda: (rotulo: string) => `Responda: ${rotulo}`,
  invalida: (rotulo: string) => `Resposta inválida: ${rotulo}`,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_PERGUNTAS = 100;
const texto = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const tipoValido = (t: unknown): t is TipoPergunta => TIPOS_PERGUNTA.some((x) => x.id === t);
const temOpcoes = (t: TipoPergunta) => t === 'escolha_unica' || t === 'multipla_escolha';

/** Modelo digitado no editor → modelo limpo, ou erros por campo (`nome`, `perguntas`, `pergunta_<n>`). */
export function validarModelo(input: { nome: unknown; perguntas: unknown }):
  | { ok: true; nome: string; perguntas: Pergunta[] }
  | { ok: false; erros: Record<string, string> } {
  const erros: Record<string, string> = {};
  const nome = texto(input.nome).slice(0, 80);
  if (!nome) erros.nome = MSG_ANAMNESE.nomeModelo;
  const brutas: (Record<string, unknown> | null)[] = Array.isArray(input.perguntas) ? input.perguntas : [];
  if (!brutas.length) erros.perguntas = MSG_ANAMNESE.semPerguntas;
  // nada é cortado em silêncio: o editor limita nome, rótulo e unidade (maxLength), mas não a lista de opções
  if (brutas.length > LIMITE_PERGUNTAS) return { ok: false, erros: { ...erros, perguntas: MSG_ANAMNESE.muitasPerguntas } };
  const ids = new Set<string>();
  const perguntas: Pergunta[] = [];
  brutas.forEach((item, i) => {
    const b = item ?? {};
    const tipo = b.tipo;
    if (!tipoValido(tipo)) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.tipo);
    const rotulo = texto(b.rotulo).slice(0, 200);
    if (!rotulo) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.rotulo);
    let id = typeof b.id === 'string' && UUID.test(b.id) ? b.id.toLowerCase() : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    const p: Pergunta = { id, tipo, rotulo, obrigatoria: b.obrigatoria === true };
    if (tipo === 'numero') {
      const unidade = texto(b.unidade).slice(0, 20);
      if (unidade) p.unidade = unidade;
    }
    if (temOpcoes(tipo)) {
      const opcoes = [...new Set((Array.isArray(b.opcoes) ? b.opcoes : []).map((o) => texto(o)).filter(Boolean))];
      if (opcoes.length > 30 || opcoes.some((o) => o.length > 100)) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.muitasOpcoes);
      if (opcoes.length < 2) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.opcoes);
      p.opcoes = opcoes;
    }
    perguntas.push(p);
  });
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, nome, perguntas };
}

/** Respostas do formulário → valores tipados. Resposta vazia não é gravada; obrigatória vazia → "Responda: …". */
export function validarRespostas(
  perguntas: Pergunta[],
  bruto: Record<string, unknown>,
): { ok: true; respostas: Record<string, Resposta> } | { ok: false; erros: Record<string, string> } {
  const respostas: Record<string, Resposta> = {};
  const erros: Record<string, string> = {};
  for (const p of perguntas) {
    const v = bruto[p.id];
    const vazio = v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
    if (vazio) {
      if (p.obrigatoria) erros[p.id] = MSG_ANAMNESE.responda(p.rotulo);
      continue;
    }
    const r = converter(p, v);
    if (r === undefined) erros[p.id] = MSG_ANAMNESE.invalida(p.rotulo);
    else respostas[p.id] = r;
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, respostas };
}

function converter(p: Pergunta, v: unknown): Resposta | undefined {
  switch (p.tipo) {
    case 'texto_curto':
    case 'texto_longo': {
      if (typeof v !== 'string') return undefined;
      const limite = p.tipo === 'texto_curto' ? 200 : 5000;
      const t = v.trim();
      return t.length <= limite ? t : undefined;
    }
    case 'numero': {
      const n = lerDecimal(v);
      return typeof n === 'number' && !Number.isNaN(n) ? n : undefined;
    }
    case 'sim_nao':
      return v === 'sim' ? true : v === 'nao' ? false : typeof v === 'boolean' ? v : undefined;
    case 'escolha_unica':
      return typeof v === 'string' && p.opcoes?.includes(v) ? v : undefined;
    case 'multipla_escolha': {
      const l = Array.isArray(v) ? v : [v];
      return l.every((x) => typeof x === 'string' && p.opcoes?.includes(x)) ? [...new Set(l as string[])] : undefined;
    }
    case 'data':
      return typeof v === 'string' && dataValida(v.trim()) ? v.trim() : undefined;
  }
}

/** Campos `r_<id>` do formulário (múltipla escolha: vários valores com o mesmo nome). */
export function respostasDoFormulario(perguntas: Pergunta[], f: FormData): Record<string, string | string[]> {
  return Object.fromEntries(
    perguntas.map((p) => [p.id, p.tipo === 'multipla_escolha' ? f.getAll(`r_${p.id}`).map(String) : String(f.get(`r_${p.id}`) ?? '')]),
  );
}

/** Resposta gravada → valor do campo do formulário (número com vírgula; sim/não como 'sim'/'nao'). */
export function respostaParaCampo(r: Resposta | undefined): string | string[] {
  if (r === undefined) return '';
  if (typeof r === 'number') return String(r).replace('.', ',');
  if (typeof r === 'boolean') return r ? 'sim' : 'nao';
  return r;
}
```

Run: `pnpm test src/modules/pacientes/anamnese-tipos.test.ts`
Expected: PASS.

- [ ] **Step 3: Modelo padrão e tabelas** — `src/modules/pacientes/anamnese-padrao.ts`

```ts
import type { ModeloSchema, Pergunta } from './anamnese-tipos';

export const NOME_MODELO_PADRAO = 'Anamnese geral';

/** US-012 "Modelo padrão": as seções da spec, uma pergunta por seção, nenhuma obrigatória (a nutricionista ajusta). */
export function modeloPadrao(): { nome: string; schema: ModeloSchema } {
  const p = (tipo: Pergunta['tipo'], rotulo: string, extra: Partial<Pergunta> = {}): Pergunta => ({ id: crypto.randomUUID(), tipo, rotulo, obrigatoria: false, ...extra });
  return {
    nome: NOME_MODELO_PADRAO,
    schema: {
      perguntas: [
        p('texto_longo', 'Queixa principal'),
        p('texto_longo', 'Histórico clínico'),
        p('texto_longo', 'Medicamentos'),
        p('texto_longo', 'Alergias/intolerâncias'),
        p('escolha_unica', 'Hábitos intestinais', { opcoes: ['Regular', 'Constipação', 'Diarreia frequente', 'Alterna constipação e diarreia'] }),
        p('numero', 'Sono', { unidade: 'horas por noite' }),
        p('texto_longo', 'Atividade física'),
        p('numero', 'Consumo de água', { unidade: 'litros por dia' }),
        p('texto_curto', 'Álcool/tabaco'),
        p('texto_longo', 'Preferências e aversões'),
      ],
    },
  };
}
```

Acrescentar ao `src/db/schema/pacientes.ts` (imports: `boolean` de `drizzle-orm/pg-core`; `import type { ModeloSchema, Resposta, SnapshotModelo } from '@/modules/pacientes/anamnese-tipos';`):

```ts
/** US-012. "Excluir" = arquivar (as anamneses preenchidas guardam o snapshot). Um só modelo padrão por tenant. */
export const anamnesisTemplates = pgTable(
  'anamnesis_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: text('nome').notNull(),
    schema: jsonb('schema').$type<ModeloSchema>().notNull(),
    padrao: boolean('padrao').notNull().default(false),
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('anamnesis_templates_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('anamnesis_templates_padrao_idx').on(t.tenantId).where(sql`${t.padrao}`),
    check('anamnesis_templates_nome_tamanho', sql`char_length(${t.nome}) between 1 and 80`),
  ],
);

export const anamneses = pgTable(
  'anamneses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    templateId: uuid('template_id'),
    templateSnapshot: jsonb('template_snapshot').$type<SnapshotModelo>().notNull(),
    respostas: jsonb('respostas').$type<Record<string, Resposta>>().notNull().default({}),
    data: date('data', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'anamneses_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.templateId], foreignColumns: [anamnesisTemplates.tenantId, anamnesisTemplates.id], name: 'anamneses_modelo_fk' }),
    index('anamneses_paciente_idx').on(t.tenantId, t.patientId, t.data),
  ],
);

export type AnamnesisTemplateRow = typeof anamnesisTemplates.$inferSelect;
export type AnamneseRow = typeof anamneses.$inferSelect;
```

Run: `pnpm db:generate --name anamnese` → `drizzle/0025_anamnese.sql`.

Run: `pnpm drizzle-kit generate --custom --name rls_anamnese` e preencher `drizzle/0026_rls_anamnese.sql`:

```sql
SELECT app_enable_tenant_rls('anamnesis_templates');
--> statement-breakpoint
SELECT app_enable_tenant_rls('anamneses');
--> statement-breakpoint
SELECT app_enable_patient_rls('anamneses');
--> statement-breakpoint
SELECT app_enable_audit('anamneses', 'anamnese');
```

`test/isolamento.test.ts`, no `FABRICAS` (o `ULTIMAS` já tem `anamnesis_templates`):

```ts
  anamnesis_templates: (t) => sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${t}, 'Iso', '{"perguntas":[]}')`,
  anamneses: (t, p) =>
    sql`insert into anamneses (tenant_id, patient_id, template_snapshot, data) values (${t}, ${p}, '{"nome":"Iso","perguntas":[]}', '2026-01-01')`,
```

`src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `anamnese: 'Anamnese',`.

Run: `pnpm test src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 4: Testes que falham do serviço** — `src/modules/pacientes/anamnese.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { anamneses, auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import {
  AnamneseError,
  arquivarModelo,
  atualizarAnamnese,
  buscarAnamnese,
  buscarModelo,
  listarAnamneses,
  listarModelos,
  preencherAnamnese,
  salvarModelo,
} from './anamnese';
import { NOME_MODELO_PADRAO } from './anamnese-padrao';
import { PacienteNaoEncontradoError } from './base';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
afterAll(() => app.pool.end());

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AnamneseError) return e.erros;
    throw e;
  }
  throw new Error('esperava AnamneseError');
};

describe('modelos de anamnese (US-012)', () => {
  it('"Modelo padrão": a conta nova já tem "Anamnese geral" com as seções da spec — uma vez só, mesmo com chamadas simultâneas', async () => {
    const T = await novoTenant(app.db);
    const listas = await Promise.all([listarModelos(T.ctx, app.db), listarModelos(T.ctx, app.db), listarModelos(T.ctx, app.db)]);
    for (const l of listas) expect(l.map((m) => m.nome)).toEqual([NOME_MODELO_PADRAO]);
    const [resumo] = listas[0];
    const modelo = await buscarModelo(T.ctx, resumo.id, app.db);
    expect(modelo?.schema.perguntas.map((p) => p.rotulo)).toEqual([
      // texto exato da spec (US-012 "Modelo padrão"; CLAUDE.md regra 4), só com a inicial maiúscula
      'Queixa principal', 'Histórico clínico', 'Medicamentos', 'Alergias/intolerâncias', 'Hábitos intestinais',
      'Sono', 'Atividade física', 'Consumo de água', 'Álcool/tabaco', 'Preferências e aversões',
    ]);
  });

  it('cria, edita e arquiva; o padrão arquivado não volta; modelo inválido devolve os erros', async () => {
    const T = await novoTenant(app.db);
    const [padrao] = await listarModelos(T.ctx, app.db);
    const id = await salvarModelo(T.ctx, null, { nome: 'Retorno', perguntas: [{ tipo: 'texto_curto', rotulo: 'Como foi a semana?', obrigatoria: false }] }, app.db);
    await salvarModelo(T.ctx, id, { nome: 'Retorno mensal', perguntas: [{ tipo: 'texto_curto', rotulo: 'Como foi o mês?', obrigatoria: true }] }, app.db);
    expect((await buscarModelo(T.ctx, id, app.db))?.nome).toBe('Retorno mensal');
    await arquivarModelo(T.ctx, padrao.id, app.db);
    expect((await listarModelos(T.ctx, app.db)).map((m) => m.nome)).toEqual(['Retorno mensal']);
    expect(await erros(salvarModelo(T.ctx, null, { nome: '', perguntas: [] }, app.db))).toEqual({ nome: 'Informe o nome do modelo', perguntas: 'Inclua pelo menos uma pergunta' });
  });
});

describe('preencher anamnese', () => {
  async function comModelo(perguntas: unknown[]) {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const modeloId = await salvarModelo(T.ctx, null, { nome: 'Consulta', perguntas }, app.db);
    const modelo = (await buscarModelo(T.ctx, modeloId, app.db))!;
    return { T, p, modeloId, perguntas: modelo.schema.perguntas };
  }

  it('"Obrigatória não preenchida": "Responda: Alergias" e nada é salvo', async () => {
    const { T, p, modeloId, perguntas } = await comModelo([{ tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: true }]);
    expect(await erros(preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, {}, { db: app.db, now }))).toEqual({ [perguntas[0].id]: 'Responda: Alergias' });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(anamneses).where(eq(anamneses.patientId, p.id)), app.db)).toEqual([]);
  });

  it('editar e esvaziar uma obrigatória: "Responda: Alergias" e a resposta gravada continua a mesma', async () => {
    const { T, p, modeloId, perguntas } = await comModelo([{ tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: true }]);
    const id = await preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, { [perguntas[0].id]: 'Lactose' }, { db: app.db, now });
    expect(await erros(atualizarAnamnese(T.ctx, p.id, id, { [perguntas[0].id]: '  ' }, app.db))).toEqual({ [perguntas[0].id]: 'Responda: Alergias' });
    expect((await buscarAnamnese(T.ctx, p.id, id, app.db))?.respostas).toEqual({ [perguntas[0].id]: 'Lactose' });
  });

  it('"Snapshot do modelo": alterar ou excluir pergunta depois não muda a anamnese já preenchida', async () => {
    const { T, p, modeloId, perguntas } = await comModelo([
      { tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: false },
      { tipo: 'numero', rotulo: 'Água', obrigatoria: false, unidade: 'litros por dia' },
    ]);
    const id = await preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, { [perguntas[0].id]: 'Lactose', [perguntas[1].id]: '2,5' }, { db: app.db, now });
    await salvarModelo(T.ctx, modeloId, { nome: 'Consulta v2', perguntas: [{ ...perguntas[0], rotulo: 'Alergias alimentares' }] }, app.db);
    await arquivarModelo(T.ctx, modeloId, app.db);
    const a = await buscarAnamnese(T.ctx, p.id, id, app.db);
    expect(a?.templateSnapshot).toEqual({ nome: 'Consulta', perguntas });
    expect(a?.respostas).toEqual({ [perguntas[0].id]: 'Lactose', [perguntas[1].id]: 2.5 });
    expect(a?.data).toBe('2026-10-01');
    // editar valida contra o snapshot, não contra o modelo atual
    await atualizarAnamnese(T.ctx, p.id, id, { [perguntas[0].id]: 'Glúten', [perguntas[1].id]: '3' }, app.db);
    expect((await buscarAnamnese(T.ctx, p.id, id, app.db))?.respostas).toEqual({ [perguntas[0].id]: 'Glúten', [perguntas[1].id]: 3 });
  });

  it('auditoria: preencher = "criar" e abrir = "ler", com a nutricionista, no histórico do paciente', async () => {
    const { T, p, modeloId } = await comModelo([{ tipo: 'texto_curto', rotulo: 'Queixa', obrigatoria: false }]);
    const id = await preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, {}, { db: app.db, now });
    await buscarAnamnese(T.ctx, p.id, id, app.db);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.entidade, 'anamnese'))), app.db);
    expect(log.map((l) => l.acao).sort()).toEqual(['criar', 'ler']);
    expect((await listarAnamneses(T.ctx, p.id, app.db)).map((a) => a.nomeModelo)).toEqual(['Consulta']);
  });

  it('paciente ou modelo de outro tenant: recusado', async () => {
    const A = await comModelo([{ tipo: 'texto_curto', rotulo: 'Q', obrigatoria: false }]);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(preencherAnamnese(A.T.ctx, A.T.tenant, pB.id, A.modeloId, {}, { db: app.db, now })).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await erros(preencherAnamnese(B.ctx, B.tenant, pB.id, A.modeloId, {}, { db: app.db, now }))).toEqual({ geral: 'Modelo de anamnese não encontrado.' });
    expect(await buscarAnamnese(B.ctx, pB.id, 'abc', app.db)).toBeNull();
  });
});
```

Run: `pnpm test src/modules/pacientes/anamnese.test.ts`
Expected: FAIL — `Cannot find module './anamnese'`.

- [ ] **Step 5: Implementar o serviço** — `src/modules/pacientes/anamnese.ts`

```ts
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { anamneses, anamnesisTemplates, type AnamneseRow, type AnamnesisTemplateRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { auditRead } from '@/modules/plataforma/audit';
import { modeloPadrao } from './anamnese-padrao';
import { MSG_ANAMNESE, validarModelo, validarRespostas } from './anamnese-tipos';
import { carregarPacienteParaEscrita, idValido } from './base';
import { hojeNoFuso } from './datas';

/** Erros por pergunta (id), por campo do modelo (`nome`, `pergunta_<n>`) ou `geral`. */
export class AnamneseError extends Error {
  override name = 'AnamneseError';
  constructor(readonly erros: Record<string, string>) {
    super('Anamnese inválida');
  }
}

export type ModeloResumo = { id: string; nome: string; padrao: boolean; perguntas: number };

/** Cria o "Anamnese geral" se o tenant nunca teve um padrão. Corrida: o índice único parcial decide. */
export async function garantirModeloPadrao(tx: Tx, tenantId: string): Promise<void> {
  const m = modeloPadrao();
  await tx.insert(anamnesisTemplates).values({ tenantId, nome: m.nome, schema: m.schema, padrao: true }).onConflictDoNothing();
}

export async function listarModelos(ctx: TenantContext, db: Db = getDb()): Promise<ModeloResumo[]> {
  return withTenant(
    ctx,
    async (tx) => {
      await garantirModeloPadrao(tx, ctx.tenantId);
      const r = await tx
        .select()
        .from(anamnesisTemplates)
        .where(isNull(anamnesisTemplates.arquivadoEm))
        .orderBy(desc(anamnesisTemplates.padrao), asc(anamnesisTemplates.nome));
      return r.map((m) => ({ id: m.id, nome: m.nome, padrao: m.padrao, perguntas: m.schema.perguntas.length }));
    },
    db,
  );
}

export async function buscarModelo(ctx: TenantContext, id: string, db: Db = getDb()): Promise<AnamnesisTemplateRow | null> {
  if (!idValido(id)) return null;
  const [m] = await withTenant(ctx, (tx) => tx.select().from(anamnesisTemplates).where(and(eq(anamnesisTemplates.id, id), isNull(anamnesisTemplates.arquivadoEm))), db);
  return m ?? null;
}

/** Cria (`id` nulo) ou altera um modelo ativo. Anamneses já preenchidas não mudam (snapshot). */
export async function salvarModelo(ctx: TenantContext, id: string | null, input: { nome: unknown; perguntas: unknown }, db: Db = getDb()): Promise<string> {
  const v = validarModelo(input);
  if (!v.ok) throw new AnamneseError(v.erros);
  return withTenant(
    ctx,
    async (tx) => {
      if (!id) {
        const [m] = await tx.insert(anamnesisTemplates).values({ tenantId: ctx.tenantId, nome: v.nome, schema: { perguntas: v.perguntas } }).returning({ id: anamnesisTemplates.id });
        return m.id;
      }
      const [m] = idValido(id)
        ? await tx
            .update(anamnesisTemplates)
            .set({ nome: v.nome, schema: { perguntas: v.perguntas }, updatedAt: new Date() })
            .where(and(eq(anamnesisTemplates.id, id), isNull(anamnesisTemplates.arquivadoEm)))
            .returning({ id: anamnesisTemplates.id })
        : [];
      if (!m) throw new AnamneseError({ geral: MSG_ANAMNESE.modeloNaoEncontrado });
      return m.id;
    },
    db,
  );
}

export async function arquivarModelo(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(ctx, (tx) => tx.update(anamnesisTemplates).set({ arquivadoEm: new Date() }).where(eq(anamnesisTemplates.id, id)), db);
}

/** US-012: valida as respostas contra o modelo atual e grava uma cópia dele (snapshot). Nenhum erro = nada salvo. */
export async function preencherAnamnese(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  templateId: string,
  bruto: Record<string, unknown>,
  deps: { db?: Db; now?: Date } = {},
): Promise<string> {
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const [m] = idValido(templateId)
        ? await tx.select().from(anamnesisTemplates).where(and(eq(anamnesisTemplates.id, templateId), isNull(anamnesisTemplates.arquivadoEm)))
        : [];
      if (!m) throw new AnamneseError({ geral: MSG_ANAMNESE.modeloNaoEncontrado });
      const v = validarRespostas(m.schema.perguntas, bruto);
      if (!v.ok) throw new AnamneseError(v.erros);
      const [a] = await tx
        .insert(anamneses)
        .values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          templateId: m.id,
          templateSnapshot: { nome: m.nome, perguntas: m.schema.perguntas },
          respostas: v.respostas,
          data: hojeNoFuso(tenant.fuso, now),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: anamneses.id });
      return a.id;
    },
    deps.db ?? getDb(),
  );
}

/** Corrige as respostas de uma anamnese — validadas contra o snapshot dela, nunca contra o modelo atual. */
export async function atualizarAnamnese(ctx: TenantContext, patientId: string, anamneseId: string, bruto: Record<string, unknown>, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const [a] = idValido(anamneseId) ? await tx.select().from(anamneses).where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId))) : [];
      if (!a) throw new AnamneseError({ geral: 'Anamnese não encontrada.' });
      const v = validarRespostas(a.templateSnapshot.perguntas, bruto);
      if (!v.ok) throw new AnamneseError(v.erros);
      await tx.update(anamneses).set({ respostas: v.respostas, updatedAt: new Date() }).where(eq(anamneses.id, a.id));
    },
    db,
  );
}

export async function listarAnamneses(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<{ id: string; data: string; nomeModelo: string }[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(anamneses).where(eq(anamneses.patientId, patientId)).orderBy(desc(anamneses.data), desc(anamneses.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'anamnese', entidadeId: null, patientId });
      return r.map((a) => ({ id: a.id, data: a.data, nomeModelo: a.templateSnapshot.nome }));
    },
    db,
  );
}

export async function buscarAnamnese(ctx: TenantContext, patientId: string, anamneseId: string, db: Db = getDb()): Promise<AnamneseRow | null> {
  if (!idValido(anamneseId) || !idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx.select().from(anamneses).where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId)));
      if (!a) return null;
      await auditRead(tx, { entidade: 'anamnese', entidadeId: a.id, patientId });
      return a;
    },
    db,
  );
}
```

Run: `pnpm test src/modules/pacientes/anamnese.test.ts`
Expected: PASS.

- [ ] **Step 6: Editor de modelos** — `src/app/painel/anamnese/modelos/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AnamneseError, arquivarModelo, salvarModelo } from '@/modules/pacientes/anamnese';

export type ModeloState = { erros?: Record<string, string> };

export async function salvarModeloAction(id: string | null, _prev: ModeloState, formData: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri('/painel/anamnese/modelos');
  let modelo: { nome?: unknown; perguntas?: unknown } = {};
  try {
    modelo = JSON.parse(String(formData.get('modelo') ?? '{}'));
  } catch {
    // corpo adulterado: cai na validação como modelo vazio
  }
  try {
    await salvarModelo(ctx, id, { nome: modelo.nome, perguntas: modelo.perguntas });
  } catch (e) {
    if (e instanceof AnamneseError) return { erros: e.erros };
    throw e;
  }
  revalidatePath('/painel/anamnese/modelos');
  redirect('/painel/anamnese/modelos');
}

export async function arquivarModeloAction(id: string): Promise<void> {
  const { ctx } = await requireNutri('/painel/anamnese/modelos');
  await arquivarModelo(ctx, id);
  revalidatePath('/painel/anamnese/modelos');
}
```

`src/app/painel/anamnese/modelos/modelo-editor.tsx`

```tsx
'use client';

import { useActionState, useRef, useState } from 'react';
import { TIPOS_PERGUNTA, type Pergunta, type TipoPergunta } from '@/modules/pacientes/anamnese-tipos';
import type { ModeloState } from './actions';

type Rascunho = { id: string; tipo: TipoPergunta; rotulo: string; obrigatoria: boolean; unidade: string; opcoes: string };
const paraRascunho = (p: Pergunta): Rascunho => ({ id: p.id, tipo: p.tipo, rotulo: p.rotulo, obrigatoria: p.obrigatoria, unidade: p.unidade ?? '', opcoes: (p.opcoes ?? []).join('\n') });
/**
 * Id local e determinístico da pergunta nova (o servidor troca por um UUID em `validarModelo`): `crypto.randomUUID()`
 * aqui daria ids diferentes no SSR e na hidratação (`rotulo-…`, `tipo-…` sem casar) e nem existe fora de HTTPS.
 */
const nova = (id: string): Rascunho => ({ id, tipo: 'texto_curto', rotulo: '', obrigatoria: false, unidade: '', opcoes: '' });
const LIMITE_PERGUNTAS = 100;

type Props = {
  acao: (prev: ModeloState, formData: FormData) => Promise<ModeloState>;
  inicial: { nome: string; perguntas: Pergunta[] };
};

/** Editor de modelo (US-012): o modelo vai inteiro, em JSON, num campo escondido; o servidor valida tudo de novo. */
export function ModeloEditor({ acao, inicial }: Props) {
  const [state, action, pendente] = useActionState<ModeloState, FormData>(acao, {});
  const [nome, setNome] = useState(inicial.nome);
  const seq = useRef(1);
  const [perguntas, setPerguntas] = useState<Rascunho[]>(inicial.perguntas.length ? inicial.perguntas.map(paraRascunho) : [nova('nova-0')]);
  const e = state.erros ?? {};
  const mudar = (i: number, parte: Partial<Rascunho>) => setPerguntas((ps) => ps.map((p, j) => (j === i ? { ...p, ...parte } : p)));
  const mover = (i: number, d: -1 | 1) =>
    setPerguntas((ps) => {
      const j = i + d;
      if (j < 0 || j >= ps.length) return ps;
      const c = [...ps];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const json = JSON.stringify({
    nome,
    perguntas: perguntas.map((p) => ({ id: p.id, tipo: p.tipo, rotulo: p.rotulo, obrigatoria: p.obrigatoria, unidade: p.unidade, opcoes: p.opcoes.split('\n') })),
  });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="modelo" value={json} />
      <div className="space-y-1">
        <label htmlFor="nome-modelo" className="block font-medium">Nome do modelo</label>
        <input id="nome-modelo" value={nome} onChange={(ev) => setNome(ev.target.value)} maxLength={80} className="w-full rounded border p-2"
          aria-invalid={e.nome ? true : undefined} aria-describedby={e.nome ? 'nome-modelo-erro' : undefined} />
        {e.nome && <p id="nome-modelo-erro" role="alert" className="text-sm text-red-700">{e.nome}</p>}
      </div>
      <ol className="space-y-4">
        {perguntas.map((p, i) => {
          const n = i + 1;
          const erro = e[`pergunta_${i}`];
          return (
            <li key={p.id} className="space-y-2 rounded border p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor={`rotulo-${p.id}`} className="block font-medium">{`Texto da pergunta ${n}`}</label>
                  <input id={`rotulo-${p.id}`} value={p.rotulo} onChange={(ev) => mudar(i, { rotulo: ev.target.value })} maxLength={200} className="w-full rounded border p-2"
                    aria-invalid={erro ? true : undefined} aria-describedby={erro ? `erro-${p.id}` : undefined} />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`tipo-${p.id}`} className="block font-medium">{`Tipo da pergunta ${n}`}</label>
                  <select id={`tipo-${p.id}`} value={p.tipo} onChange={(ev) => mudar(i, { tipo: ev.target.value as TipoPergunta })} className="w-full rounded border p-2">
                    {TIPOS_PERGUNTA.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
                  </select>
                </div>
              </div>
              {p.tipo === 'numero' && (
                <div className="space-y-1">
                  <label htmlFor={`unidade-${p.id}`} className="block">{`Unidade da pergunta ${n} (opcional)`}</label>
                  <input id={`unidade-${p.id}`} value={p.unidade} onChange={(ev) => mudar(i, { unidade: ev.target.value })} maxLength={20} className="rounded border p-2" />
                </div>
              )}
              {(p.tipo === 'escolha_unica' || p.tipo === 'multipla_escolha') && (
                <div className="space-y-1">
                  <label htmlFor={`opcoes-${p.id}`} className="block">{`Opções da pergunta ${n} (uma por linha)`}</label>
                  <textarea id={`opcoes-${p.id}`} value={p.opcoes} onChange={(ev) => mudar(i, { opcoes: ev.target.value })} rows={4} className="w-full rounded border p-2" />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <input id={`obrigatoria-${p.id}`} type="checkbox" checked={p.obrigatoria} onChange={(ev) => mudar(i, { obrigatoria: ev.target.checked })} />
                  <label htmlFor={`obrigatoria-${p.id}`}>{`Pergunta ${n} obrigatória`}</label>
                </div>
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="underline" aria-label={`Subir a pergunta ${n}`}>Subir</button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === perguntas.length - 1} className="underline" aria-label={`Descer a pergunta ${n}`}>Descer</button>
                <button type="button" onClick={() => setPerguntas((ps) => ps.filter((_, j) => j !== i))} className="underline" aria-label={`Remover a pergunta ${n}`}>Remover</button>
              </div>
              {erro && <p id={`erro-${p.id}`} role="alert" className="text-sm text-red-700">{erro}</p>}
            </li>
          );
        })}
      </ol>
      {e.perguntas && <p role="alert" className="text-red-700">{e.perguntas}</p>}
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      <div className="flex gap-3">
        <button type="button" disabled={perguntas.length >= LIMITE_PERGUNTAS} onClick={() => setPerguntas((ps) => [...ps, nova(`nova-${seq.current++}`)])} className="rounded border px-4 py-2 disabled:opacity-50">Adicionar pergunta</button>
        <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Salvar modelo</button>
      </div>
    </form>
  );
}
```

`src/app/painel/anamnese/modelos/page.tsx`

```tsx
import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { listarModelos } from '@/modules/pacientes/anamnese';
import { Cabecalho } from '../../cabecalho';
import { arquivarModeloAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ModelosPage() {
  const { ctx, tenant } = await requireNutri('/painel/anamnese/modelos');
  const modelos = await listarModelos(ctx);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Modelos de anamnese</h1>
          <Link href="/painel/anamnese/modelos/novo" className="rounded bg-emerald-700 px-4 py-2 text-white">Novo modelo</Link>
        </div>
        <ul className="divide-y">
          {modelos.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>{`${m.nome}${m.padrao ? ' (padrão)' : ''} · ${m.perguntas} ${m.perguntas === 1 ? 'pergunta' : 'perguntas'}`}</span>
              <span className="flex gap-4">
                <Link href={`/painel/anamnese/modelos/${m.id}`} className="underline" aria-label={`Editar o modelo ${m.nome}`}>Editar</Link>
                <form action={arquivarModeloAction.bind(null, m.id)}>
                  <ConfirmarBotao mensagem="Arquivar este modelo? As anamneses já preenchidas não mudam." rotulo={`Arquivar o modelo ${m.nome}`}>Arquivar</ConfirmarBotao>
                </form>
              </span>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
```

`src/app/painel/anamnese/modelos/novo/page.tsx`

```tsx
import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from '../../../cabecalho';
import { salvarModeloAction } from '../actions';
import { ModeloEditor } from '../modelo-editor';

export const dynamic = 'force-dynamic';

export default async function NovoModeloPage() {
  const { tenant } = await requireNutri('/painel/anamnese/modelos/novo');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Novo modelo de anamnese</h1>
        <ModeloEditor acao={salvarModeloAction.bind(null, null)} inicial={{ nome: '', perguntas: [] }} />
      </main>
    </>
  );
}
```

`src/app/painel/anamnese/modelos/[modeloId]/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { buscarModelo } from '@/modules/pacientes/anamnese';
import { Cabecalho } from '../../../cabecalho';
import { salvarModeloAction } from '../actions';
import { ModeloEditor } from '../modelo-editor';

export const dynamic = 'force-dynamic';

export default async function EditarModeloPage({ params }: PageProps<'/painel/anamnese/modelos/[modeloId]'>) {
  const { modeloId } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/anamnese/modelos/${modeloId}`);
  const modelo = await buscarModelo(ctx, modeloId);
  if (!modelo) notFound();
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Editar modelo de anamnese</h1>
        <p className="text-sm text-zinc-700">As anamneses já preenchidas continuam com as perguntas de quando foram respondidas.</p>
        <ModeloEditor acao={salvarModeloAction.bind(null, modelo.id)} inicial={{ nome: modelo.nome, perguntas: modelo.schema.perguntas }} />
      </main>
    </>
  );
}
```

Em `src/app/painel/cabecalho.tsx`, no `<nav>`, depois de "Pacientes": `<Link href="/painel/anamnese/modelos">Modelos de anamnese</Link>`.

- [ ] **Step 7: Preenchimento no prontuário** — `src/app/painel/pacientes/[id]/anamnese/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AnamneseError, atualizarAnamnese, buscarAnamnese, buscarModelo, preencherAnamnese } from '@/modules/pacientes/anamnese';
import { respostasDoFormulario } from '@/modules/pacientes/anamnese-tipos';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type AnamneseState = { erros?: Record<string, string>; valores?: Record<string, string | string[]>; ok?: boolean; envio?: number };

function tratar(e: unknown, valores: Record<string, string | string[]>): AnamneseState {
  if (e instanceof AnamneseError) return { erros: e.erros, valores, envio: Date.now() };
  if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores, envio: Date.now() };
  if (e instanceof PacienteNaoEncontradoError) notFound();
  throw e;
}

export async function preencherAnamneseAction(patientId: string, modeloId: string, _prev: AnamneseState, formData: FormData): Promise<AnamneseState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/anamnese`);
  const modelo = await buscarModelo(ctx, modeloId);
  if (!modelo) notFound();
  const valores = respostasDoFormulario(modelo.schema.perguntas, formData);
  let id: string;
  try {
    id = await preencherAnamnese(ctx, tenant, patientId, modeloId, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  redirect(`/painel/pacientes/${patientId}/anamnese/${id}`);
}

export async function atualizarAnamneseAction(patientId: string, anamneseId: string, _prev: AnamneseState, formData: FormData): Promise<AnamneseState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/anamnese/${anamneseId}`);
  const a = await buscarAnamnese(ctx, patientId, anamneseId);
  if (!a) notFound();
  const valores = respostasDoFormulario(a.templateSnapshot.perguntas, formData);
  try {
    await atualizarAnamnese(ctx, patientId, anamneseId, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  revalidatePath(`/painel/pacientes/${patientId}/anamnese/${anamneseId}`);
  return { ok: true, envio: Date.now() };
}
```

`src/app/painel/pacientes/[id]/anamnese/anamnese-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import type { Pergunta } from '@/modules/pacientes/anamnese-tipos';
import type { AnamneseState } from './actions';

type Props = {
  acao: (prev: AnamneseState, formData: FormData) => Promise<AnamneseState>;
  perguntas: Pergunta[];
  inicial: Record<string, string | string[]>;
  botao: string;
  somenteLeitura: boolean;
};

export function AnamneseForm({ acao, perguntas, inicial, botao, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<AnamneseState, FormData>(acao, {});
  const valores = state.valores ?? inicial;
  const erros = state.erros ?? {};
  // O modelo pode ter ganhado uma pergunta obrigatória depois que a tela abriu: o erro dela não tem campo aqui
  const naTela = new Set(perguntas.map((p) => p.id));
  const semCampo = Object.entries(erros).filter(([k]) => k !== 'geral' && !naTela.has(k)).map(([, v]) => v);
  return (
    <form action={action} className="space-y-4">
      <fieldset key={state.envio ?? 0} disabled={somenteLeitura} className="space-y-4">
        {perguntas.map((p) => (
          <Campo key={p.id} p={p} valor={valores[p.id] ?? (p.tipo === 'multipla_escolha' ? [] : '')} erro={erros[p.id]} />
        ))}
      </fieldset>
      {erros.geral && <p role="alert" className="text-red-700">{erros.geral}</p>}
      {semCampo.length > 0 && (
        <p role="alert" className="text-red-700">{`O modelo mudou enquanto você preenchia. Recarregue a página. (${semCampo.join(' · ')})`}</p>
      )}
      {state.ok && <p role="status">Anamnese salva.</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{botao}</button>}
    </form>
  );
}

function Campo({ p, valor, erro }: { p: Pergunta; valor: string | string[]; erro?: string }) {
  const nome = `r_${p.id}`;
  const rotulo = `${p.rotulo}${p.tipo === 'numero' && p.unidade ? ` (${p.unidade})` : ''}${p.obrigatoria ? ' (obrigatória)' : ''}`;
  const aria = erro ? { 'aria-invalid': true as const, 'aria-describedby': `${nome}-erro` } : {};
  const mensagem = erro && <p id={`${nome}-erro`} role="alert" className="text-sm text-red-700">{erro}</p>;
  const texto = typeof valor === 'string' ? valor : '';
  if (p.tipo === 'sim_nao' || p.tipo === 'escolha_unica' || p.tipo === 'multipla_escolha') {
    const opcoes = p.tipo === 'sim_nao' ? [['sim', 'Sim'], ['nao', 'Não']] : (p.opcoes ?? []).map((o) => [o, o]);
    const multipla = p.tipo === 'multipla_escolha';
    return (
      <fieldset className="space-y-1" {...(erro ? { 'aria-describedby': `${nome}-erro` } : {})}>
        <legend className="font-medium">{rotulo}</legend>
        {opcoes.map(([v, r], i) => (
          <div key={v} className="flex items-center gap-2">
            <input id={`${nome}-${i}`} name={nome} type={multipla ? 'checkbox' : 'radio'} value={v}
              defaultChecked={multipla ? (valor as string[]).includes(v) : texto === v} aria-invalid={erro ? true : undefined} />
            <label htmlFor={`${nome}-${i}`}>{r}</label>
          </div>
        ))}
        {mensagem}
      </fieldset>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={nome} className="block font-medium">{rotulo}</label>
      {p.tipo === 'texto_longo' ? (
        <textarea id={nome} name={nome} defaultValue={texto} rows={3} maxLength={5000} className="w-full rounded border p-2" {...aria} />
      ) : (
        <input id={nome} name={nome} defaultValue={texto} className="w-full rounded border p-2" {...aria}
          {...(p.tipo === 'data' ? { type: 'date' } : p.tipo === 'numero' ? { inputMode: 'decimal' as const } : { maxLength: 200 })} />
      )}
      {mensagem}
    </div>
  );
}
```

`src/app/painel/pacientes/[id]/anamnese/page.tsx`

```tsx
import Link from 'next/link';
import { listarAnamneses, listarModelos } from '@/modules/pacientes/anamnese';
import { formatarData } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

export default async function AnamnesesPage({ params }: PageProps<'/painel/pacientes/[id]/anamnese'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const [lista, modelos] = await Promise.all([listarAnamneses(ctx, paciente.id), listarModelos(ctx)]);
  return (
    <div className="space-y-8">
      {paciente.status !== 'bloqueado' && (
        <form action={`/painel/pacientes/${paciente.id}/anamnese/nova`} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="modelo" className="block font-medium">Modelo</label>
            <select id="modelo" name="modelo" className="rounded border p-2">
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <button className="rounded bg-emerald-700 px-4 py-2 text-white">Preencher anamnese</button>
        </form>
      )}
      <section aria-labelledby="anamneses" className="space-y-2">
        <h2 id="anamneses" className="text-lg font-semibold">Anamneses</h2>
        {lista.length === 0 ? (
          <p>Nenhuma anamnese preenchida.</p>
        ) : (
          <ul className="divide-y">
            {lista.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/painel/pacientes/${paciente.id}/anamnese/${a.id}`} className="underline">{`${formatarData(a.data)} · ${a.nomeModelo}`}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

`src/app/painel/pacientes/[id]/anamnese/nova/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import { buscarModelo } from '@/modules/pacientes/anamnese';
import { carregarProntuario } from '../../prontuario';
import { preencherAnamneseAction } from '../actions';
import { AnamneseForm } from '../anamnese-form';

export const dynamic = 'force-dynamic';

export default async function NovaAnamnesePage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/anamnese/nova'>) {
  const { id } = await params;
  const { modelo: modeloId } = await searchParams;
  const { ctx, paciente } = await carregarProntuario(id);
  const modelo = typeof modeloId === 'string' ? await buscarModelo(ctx, modeloId) : null;
  if (!modelo) notFound();
  return (
    <section aria-labelledby="nova-anamnese" className="max-w-3xl space-y-3">
      <h2 id="nova-anamnese" className="text-lg font-semibold">{modelo.nome}</h2>
      <AnamneseForm acao={preencherAnamneseAction.bind(null, paciente.id, modelo.id)} perguntas={modelo.schema.perguntas} inicial={{}} botao="Salvar anamnese" somenteLeitura={paciente.status === 'bloqueado'} />
    </section>
  );
}
```

`src/app/painel/pacientes/[id]/anamnese/[anamneseId]/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import { buscarAnamnese } from '@/modules/pacientes/anamnese';
import { respostaParaCampo } from '@/modules/pacientes/anamnese-tipos';
import { formatarData } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../prontuario';
import { atualizarAnamneseAction } from '../actions';
import { AnamneseForm } from '../anamnese-form';

export const dynamic = 'force-dynamic';

export default async function AnamnesePage({ params }: PageProps<'/painel/pacientes/[id]/anamnese/[anamneseId]'>) {
  const { id, anamneseId } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const a = await buscarAnamnese(ctx, paciente.id, anamneseId);
  if (!a) notFound();
  const inicial = Object.fromEntries(a.templateSnapshot.perguntas.map((p) => [p.id, respostaParaCampo(a.respostas[p.id])]));
  return (
    <section aria-labelledby="anamnese-titulo" className="max-w-3xl space-y-3">
      <h2 id="anamnese-titulo" className="text-lg font-semibold">{`${a.templateSnapshot.nome} · ${formatarData(a.data)}`}</h2>
      <AnamneseForm
        acao={atualizarAnamneseAction.bind(null, paciente.id, a.id)}
        perguntas={a.templateSnapshot.perguntas}
        inicial={inicial}
        botao="Salvar alterações"
        somenteLeitura={paciente.status === 'bloqueado'}
      />
    </section>
  );
}
```

Em `abas.tsx`, acrescentar antes de `historico`: `{ seg: 'anamnese', rotulo: 'Anamnese' },`.

- [ ] **Step 8: E2E** — acrescentar ao `e2e/pacientes.spec.ts`:

```ts
test('anamnese: modelo com "Alergias" obrigatória recusa salvar vazia e depois salva (US-012)', async () => {
  await nutri.goto('/painel/anamnese/modelos');
  await expect(nutri.getByText(/^Anamnese geral \(padrão\)/)).toBeVisible(); // "Modelo padrão"
  await nutri.getByRole('link', { name: 'Novo modelo' }).click();
  const nomeModelo = `Triagem ${sufixo}`;
  await nutri.getByLabel('Nome do modelo').fill(nomeModelo);
  await nutri.getByLabel('Texto da pergunta 1').fill('Alergias');
  await nutri.getByLabel('Pergunta 1 obrigatória').check();
  await nutri.getByRole('button', { name: 'Adicionar pergunta' }).click();
  await nutri.getByLabel('Texto da pergunta 2').fill('Refeições por dia');
  await nutri.getByLabel('Tipo da pergunta 2').selectOption('numero');
  await nutri.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(nutri).toHaveURL(/\/painel\/anamnese\/modelos$/);

  await nutri.goto(`${prontuario}/anamnese`);
  await nutri.getByLabel('Modelo').selectOption({ label: nomeModelo });
  await nutri.getByRole('button', { name: 'Preencher anamnese' }).click();
  await nutri.getByLabel('Refeições por dia').fill('4');
  await nutri.getByRole('button', { name: 'Salvar anamnese' }).click();
  await expect(nutri.locator('p[role="alert"]')).toHaveText('Responda: Alergias');
  await expect(nutri.getByLabel('Refeições por dia')).toHaveValue('4');
  await nutri.getByLabel('Alergias (obrigatória)').fill('Lactose');
  await nutri.getByRole('button', { name: 'Salvar anamnese' }).click();
  await expect(nutri.getByRole('heading', { name: new RegExp(`^${nomeModelo} · `) })).toBeVisible();
  await expect(nutri.getByLabel('Alergias (obrigatória)')).toHaveValue('Lactose');
});
```

- [ ] **Step 9: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e e2e/pacientes.spec.ts`
Expected: tudo verde.

```bash
git add src/modules/pacientes src/db/schema/pacientes.ts drizzle/0025_anamnese.sql drizzle/0026_rls_anamnese.sql drizzle/meta test/isolamento.test.ts \
  src/modules/plataforma/audit.ts src/app/painel e2e/pacientes.spec.ts
git commit -m "feat(pacientes): anamnese com modelos editáveis (7 tipos), modelo padrão e preenchimento com snapshot (P03-04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Registro de atendimento — notas privadas × orientações ao paciente (P03-09)

**Files:**
- Create: `drizzle/0027_atendimentos.sql` (gerada), `drizzle/0028_rls_atendimentos.sql` (custom), `src/modules/pacientes/atendimentos.ts`, `src/modules/pacientes/atendimentos.test.ts`, `src/app/painel/pacientes/[id]/atendimentos/page.tsx`, `src/app/painel/pacientes/[id]/atendimentos/[atendimentoId]/page.tsx`, `src/app/painel/pacientes/[id]/atendimentos/actions.ts`, `src/app/painel/pacientes/[id]/atendimentos/atendimento-form.tsx`
- Modify: `src/db/schema/pacientes.ts` (tabelas novas + `anthropometry.consultation_id`), `src/db/rls-guard.ts` (`STAFF_ONLY`), `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts`, `src/modules/pacientes/antropometria.ts`, `src/modules/pacientes/antropometria.test.ts`, `src/app/painel/pacientes/[id]/antropometria/page.tsx`, `src/app/painel/pacientes/[id]/antropometria/antropometria-form.tsx`, `src/app/painel/pacientes/[id]/abas.tsx`

**Interfaces:**
- Consumes: `app_enable_staff_only`, `STAFF_ONLY` (Tarefa 5); `carregarPacienteParaEscrita`, `idValido` (Tarefa 1); `dataValida`, `hojeNoFuso`, `formatarData` (Tarefa 1); `MSG_ANTROPO`, `registrarAntropometria`, `entradaDoFormulario`, `AntropometriaError` (Tarefa 7); `auditRead`; `carregarProntuario`; `ctxPaciente` (`test/pacientes.ts`).
- Produces:
  - Schema: `consultations` 🔒 (`data`, `orientacoes_paciente`; UNIQUE `(tenant_id, patient_id, id)`), `consultationNotes` 🔒 `staff_only` (`consultation_id` UNIQUE, FK tripla com `ON DELETE CASCADE`), `anthropometry.consultation_id` (FK tripla). O Plano 05 acrescenta `consultations.appointment_id`.
  - `@/modules/pacientes/atendimentos`: `MSG_ATENDIMENTO`, `class AtendimentoError { erros }`, `type Atendimento = { id; data; orientacoesPaciente; notasPrivadas; createdAt }`, `registrarAtendimento(ctx, tenant, patientId, input, deps?): Promise<string>`, `atualizarAtendimento(ctx, tenant, patientId, id, input, deps?): Promise<void>`, `listarAtendimentos(ctx, patientId, db?)`, `buscarAtendimento(ctx, patientId, id, db?)`, `orientacoesDoPaciente(ctx, db?): Promise<{ data: string; orientacoes: string }[]>` (para o portal, Plano 06 — nunca toca nas notas).
  - `EntradaAntropometria.consultationId?: string | null`; `registrarAntropometria` liga a avaliação ao atendimento.

- [ ] **Step 1: Tabelas** — acrescentar ao `src/db/schema/pacientes.ts` (`consultations` e `consultationNotes` ANTES de `anthropometry`, porque ela passa a referenciar `consultations`):

```ts
/** US-016. O que o paciente pode ver fica aqui (orientações); as notas privadas ficam em consultation_notes (staff_only). */
export const consultations = pgTable(
  'consultations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    orientacoesPaciente: text('orientacoes_paciente'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('consultations_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'consultations_paciente_fk' }),
    check('consultations_orientacoes_tamanho', sql`char_length(${t.orientacoesPaciente}) <= 5000`),
    index('consultations_paciente_data_idx').on(t.tenantId, t.patientId, t.data),
  ],
);

/** US-016 "Privacidade das notas": a sessão de paciente não vê esta tabela (staff_only). A FK tripla impede nota de um paciente no atendimento de outro. */
export const consultationNotes = pgTable(
  'consultation_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    consultationId: uuid('consultation_id').notNull().unique(),
    texto: text('texto').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'consultation_notes_paciente_fk' }),
    foreignKey({
      columns: [t.tenantId, t.patientId, t.consultationId],
      foreignColumns: [consultations.tenantId, consultations.patientId, consultations.id],
      name: 'consultation_notes_atendimento_fk',
    }).onDelete('cascade'),
    check('consultation_notes_tamanho', sql`char_length(${t.texto}) between 1 and 20000`),
  ],
);

export type ConsultationRow = typeof consultations.$inferSelect;
```

Em `anthropometry`, acrescentar a coluna `consultationId: uuid('consultation_id'),` (depois de `patientId`) e, na lista de restrições:

```ts
    foreignKey({
      columns: [t.tenantId, t.patientId, t.consultationId],
      foreignColumns: [consultations.tenantId, consultations.patientId, consultations.id],
      name: 'anthropometry_atendimento_fk',
    }),
```

Run: `pnpm db:generate --name atendimentos`
Expected: `drizzle/0027_atendimentos.sql` com as 2 tabelas, a UNIQUE tripla, as FKs (a da nota com `ON DELETE cascade`) e `ALTER TABLE "anthropometry" ADD COLUMN "consultation_id" uuid` + a FK tripla.

Run: `pnpm drizzle-kit generate --custom --name rls_atendimentos` e preencher `drizzle/0028_rls_atendimentos.sql`:

```sql
SELECT app_enable_tenant_rls('consultations');
--> statement-breakpoint
SELECT app_enable_patient_rls('consultations');
--> statement-breakpoint
SELECT app_enable_audit('consultations', 'atendimentos');
--> statement-breakpoint
SELECT app_enable_tenant_rls('consultation_notes');
--> statement-breakpoint
SELECT app_enable_patient_rls('consultation_notes');
--> statement-breakpoint
SELECT app_enable_staff_only('consultation_notes');
--> statement-breakpoint
SELECT app_enable_audit('consultation_notes', 'notas_privadas');
```

`src/db/rls-guard.ts`, no `STAFF_ONLY`: `consultation_notes: 'US-016: o paciente nunca vê as notas privadas, nem no JSON da API',`.

`test/isolamento.test.ts`, no `FABRICAS`:

```ts
  consultations: (t, p) => sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${t}, ${p}, '2026-01-01', 'x')`,
  consultation_notes: (t, p) => sql`with c as (insert into consultations (tenant_id, patient_id, data) values (${t}, ${p}, '2026-01-01') returning id)
    insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) select ${t}, ${p}, c.id, 'x' from c`,
```

`src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `atendimentos: 'Atendimento', notas_privadas: 'Notas privadas',`.

Run: `pnpm test src/db test/isolamento.test.ts`
Expected: PASS (o teste `staff_only` da matriz agora itera também `consultation_notes`).

- [ ] **Step 2: Testes que falham** — `src/modules/pacientes/atendimentos.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, consultationNotes } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { AtendimentoError, atualizarAtendimento, buscarAtendimento, listarAtendimentos, MSG_ATENDIMENTO, orientacoesDoPaciente, registrarAtendimento } from './atendimentos';
import { PacienteNaoEncontradoError } from './base';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const NOTA = 'suspeita de compulsão';
const ORIENTACAO = 'beber 2 L de água/dia';

describe('atendimentos (US-016)', () => {
  it('registra notas privadas e orientações; a auditoria vê as duas entidades, com a nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: ORIENTACAO }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ id, data: '2026-10-01', notasPrivadas: NOTA, orientacoesPaciente: ORIENTACAO });
    // filtra as duas entidades: o novoPaciente também grava "criar" em patients com o mesmo patient_id
    const log = await withTenant(
      T.ctx,
      (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'criar'), inArray(auditLog.entidade, ['atendimentos', 'notas_privadas']))),
      app.db,
    );
    expect(log.map((l) => l.entidade).sort()).toEqual(['atendimentos', 'notas_privadas']);
    expect(log.every((l) => l.actorUserId === T.nutriId)).toBe(true);
  });

  it('"Privacidade das notas": na sessão do paciente, as orientações aparecem e a nota nunca (nem no JSON)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: ORIENTACAO }, deps);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const doPortal = await orientacoesDoPaciente(ctx, app.db);
    expect(doPortal).toEqual([{ data: '2026-10-01', orientacoes: ORIENTACAO }]);
    expect(JSON.stringify(doPortal)).not.toContain(NOTA);
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'atendimentos'))), app.db);
    expect(lidas).toHaveLength(1); // o próprio paciente lendo as orientações também fica no histórico (regra 8)
    await expect(orientacoesDoPaciente(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/); // nunca com o contexto da nutricionista
    expect(await withTenant(ctx, (tx) => tx.select().from(consultationNotes), app.db)).toEqual([]);
    const vistos = await listarAtendimentos(ctx, p.id, app.db);
    expect(JSON.stringify(vistos)).not.toContain(NOTA);
    expect(vistos[0].notasPrivadas).toBeNull();
  });

  it('WITH CHECK de consultation_notes: o tenant B não grava nota no atendimento de A (42501)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pA = await novoPaciente(app.db, A.ctx);
    const idA = await registrarAtendimento(A.ctx, A.tenant, pA.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: ORIENTACAO }, deps);
    // a matriz de isolamento cria o atendimento na mesma CTE, então lá quem recusa é a RLS de consultations;
    // aqui o atendimento já existe e só a política da própria consultation_notes pode barrar
    const tentativa = withTenant(
      B.ctx,
      (tx) => tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${A.tenantId}, ${pA.id}, ${idA}, 'x')`),
      app.db,
    );
    await expect(tentativa).rejects.toSatisfy((e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code === '42501');
    expect((await buscarAtendimento(A.ctx, pA.id, idA, app.db))?.notasPrivadas).toBeNull();
  });

  it('editar troca as orientações e, com as notas vazias, apaga a nota', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: '' }, deps);
    await atualizarAtendimento(T.ctx, T.tenant, p.id, id, { data: '2026-10-01', notasPrivadas: '  ', orientacoes: ORIENTACAO }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ notasPrivadas: null, orientacoesPaciente: ORIENTACAO });
    await atualizarAtendimento(T.ctx, T.tenant, p.id, id, { data: '2026-09-30', notasPrivadas: 'nova nota', orientacoes: ORIENTACAO }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ data: '2026-09-30', notasPrivadas: 'nova nota' });
  });

  it('data futura ou texto longo demais: recusado sem gravar', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-05', notasPrivadas: 'x'.repeat(20001), orientacoes: 'y'.repeat(5001) }, deps);
    await expect(r).rejects.toBeInstanceOf(AtendimentoError);
    await expect(r).rejects.toMatchObject({ erros: { data: MSG_ATENDIMENTO.futuro, notasPrivadas: MSG_ATENDIMENTO.notas, orientacoes: MSG_ATENDIMENTO.orientacoes } });
    expect(await listarAtendimentos(T.ctx, p.id, app.db)).toEqual([]);
  });

  it('paciente de outro tenant ou atendimento de outro paciente: recusado; e o banco barra nota cruzada (FK tripla)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(registrarAtendimento(A.ctx, A.tenant, pB.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: '' }, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const p1 = await novoPaciente(app.db, A.ctx);
    const p2 = await novoPaciente(app.db, A.ctx);
    const de1 = await registrarAtendimento(A.ctx, A.tenant, p1.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: '' }, deps);
    await expect(atualizarAtendimento(A.ctx, A.tenant, p2.id, de1, { data: '2026-10-01', notasPrivadas: 'x', orientacoes: '' }, deps)).rejects.toMatchObject({
      erros: { geral: MSG_ATENDIMENTO.naoEncontrado },
    });
    expect(await buscarAtendimento(A.ctx, p2.id, de1, app.db)).toBeNull();
    const cruzada = withTenant(A.ctx, (tx) => tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${A.tenantId}, ${p2.id}, ${de1}, 'x')`), app.db);
    await expect(cruzada).rejects.toSatisfy((e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code === '23503');
    expect(await buscarAtendimento(A.ctx, p1.id, randomUUID(), app.db)).toBeNull();
  });
});
```

Acrescentar ao `src/modules/pacientes/antropometria.test.ts` (import `registrarAtendimento` de `./atendimentos` e `MSG_ATENDIMENTO`):

```ts
it('avaliação feita num atendimento fica ligada a ele; atendimento de outro paciente é recusado', async () => {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const outro = await novoPaciente(app.db, T.ctx);
  const at = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-01', notasPrivadas: '', orientacoes: '' }, deps);
  const r = await registrarAntropometria(T.ctx, T.tenant, p.id, { ...entrada({}), consultationId: at }, deps);
  expect((await listarAntropometrias(T.ctx, p.id, app.db)).find((a) => a.id === r.id)?.consultationId).toBe(at);
  expect(await erros(registrarAntropometria(T.ctx, T.tenant, outro.id, { ...entrada({}), consultationId: at }, deps))).toEqual({ geral: MSG_ATENDIMENTO.naoEncontrado });
});
```

Run: `pnpm test src/modules/pacientes/atendimentos.test.ts src/modules/pacientes/antropometria.test.ts`
Expected: FAIL — `Cannot find module './atendimentos'`.

- [ ] **Step 3: Implementar** — `src/modules/pacientes/atendimentos.ts`

```ts
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { consultationNotes, consultations } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido } from './base';
import { dataValida, hojeNoFuso } from './datas';

export const MSG_ATENDIMENTO = {
  data: 'Informe a data do atendimento',
  futuro: 'A data não pode ser no futuro',
  notas: 'Use no máximo 20000 caracteres nas notas privadas',
  orientacoes: 'Use no máximo 5000 caracteres nas orientações',
  naoEncontrado: 'Atendimento não encontrado.',
} as const;

export class AtendimentoError extends Error {
  override name = 'AtendimentoError';
  constructor(readonly erros: Record<string, string>) {
    super('Atendimento inválido');
  }
}

export type Atendimento = { id: string; data: string; orientacoesPaciente: string | null; notasPrivadas: string | null; createdAt: Date };
type Entrada = { data: unknown; notasPrivadas: unknown; orientacoes: unknown };

function validar(input: Entrada, hoje: string): { data: string; notas: string | null; orientacoes: string | null } {
  const erros: Record<string, string> = {};
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_ATENDIMENTO.data;
  else if (data > hoje) erros.data = MSG_ATENDIMENTO.futuro;
  // o navegador envia quebra de linha como CRLF, mas o maxLength do textarea conta 1 caractere: normaliza antes de medir
  const limpo = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');
  const notas = limpo(input.notasPrivadas);
  if (notas.length > 20000) erros.notasPrivadas = MSG_ATENDIMENTO.notas;
  const orientacoes = limpo(input.orientacoes);
  if (orientacoes.length > 5000) erros.orientacoes = MSG_ATENDIMENTO.orientacoes;
  if (Object.keys(erros).length) throw new AtendimentoError(erros);
  return { data, notas: notas || null, orientacoes: orientacoes || null };
}

async function gravarNota(tx: Tx, a: { tenantId: string; patientId: string; consultationId: string }, notas: string | null, now: Date) {
  if (!notas) {
    await tx.delete(consultationNotes).where(eq(consultationNotes.consultationId, a.consultationId));
    return;
  }
  await tx
    .insert(consultationNotes)
    .values({ ...a, texto: notas, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: consultationNotes.consultationId, set: { texto: notas, updatedAt: now } });
}

/** US-016: atendimento do dia (a partir da agenda no Plano 05). Notas vazias não criam linha em consultation_notes. */
export async function registrarAtendimento(ctx: TenantContext, tenant: { fuso: string }, patientId: string, input: Entrada, deps: { db?: Db; now?: Date } = {}): Promise<string> {
  const now = deps.now ?? new Date();
  const v = validar(input, hojeNoFuso(tenant.fuso, now));
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const [c] = await tx
        .insert(consultations)
        .values({ tenantId: ctx.tenantId, patientId: p.id, data: v.data, orientacoesPaciente: v.orientacoes, createdAt: now, updatedAt: now })
        .returning({ id: consultations.id });
      await gravarNota(tx, { tenantId: ctx.tenantId, patientId: p.id, consultationId: c.id }, v.notas, now);
      return c.id;
    },
    deps.db ?? getDb(),
  );
}

export async function atualizarAtendimento(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  id: string,
  input: Entrada,
  deps: { db?: Db; now?: Date } = {},
): Promise<void> {
  const now = deps.now ?? new Date();
  const v = validar(input, hojeNoFuso(tenant.fuso, now));
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const [c] = idValido(id)
        ? await tx
            .update(consultations)
            .set({ data: v.data, orientacoesPaciente: v.orientacoes, updatedAt: now })
            .where(and(eq(consultations.id, id), eq(consultations.patientId, p.id)))
            .returning({ id: consultations.id })
        : [];
      if (!c) throw new AtendimentoError({ geral: MSG_ATENDIMENTO.naoEncontrado });
      await gravarNota(tx, { tenantId: ctx.tenantId, patientId: p.id, consultationId: c.id }, v.notas, now);
    },
    deps.db ?? getDb(),
  );
}

const COLUNAS = {
  id: consultations.id,
  data: consultations.data,
  orientacoesPaciente: consultations.orientacoesPaciente,
  createdAt: consultations.createdAt,
};

/**
 * Só o atendimento aberto lê a nota (e audita "Notas privadas"): a lista mostra data e orientações, e
 * lê-la com a nota gravaria "Visualizou Notas privadas" a cada visita, sem nota nenhuma na tela.
 * Numa sessão de paciente, a política staff_only devolve a nota como nula (LEFT JOIN sem linha).
 */
async function ler(tx: Tx, patientId: string, id?: string): Promise<Atendimento[]> {
  const r: Atendimento[] = id
    ? await tx
        .select({ ...COLUNAS, notasPrivadas: consultationNotes.texto })
        .from(consultations)
        .leftJoin(consultationNotes, eq(consultationNotes.consultationId, consultations.id))
        .where(and(eq(consultations.patientId, patientId), eq(consultations.id, id)))
    : (
        await tx
          .select(COLUNAS)
          .from(consultations)
          .where(eq(consultations.patientId, patientId))
          .orderBy(desc(consultations.data), desc(consultations.createdAt))
      ).map((a) => ({ ...a, notasPrivadas: null }));
  if (r.length) {
    const notas = r.some((a) => a.notasPrivadas !== null);
    await auditRead(tx, [
      { entidade: 'atendimentos', entidadeId: id ?? null, patientId },
      ...(notas ? [{ entidade: 'notas_privadas', entidadeId: id ?? null, patientId }] : []),
    ]);
  }
  return r;
}

export async function listarAtendimentos(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Atendimento[]> {
  if (!idValido(patientId)) return [];
  return withTenant(ctx, (tx) => ler(tx, patientId), db);
}

export async function buscarAtendimento(ctx: TenantContext, patientId: string, id: string, db: Db = getDb()): Promise<Atendimento | null> {
  if (!idValido(patientId) || !idValido(id)) return null;
  return (await withTenant(ctx, (tx) => ler(tx, patientId, id), db))[0] ?? null;
}

/**
 * Para o portal (Plano 06): só as orientações, só do paciente da sessão. Não toca em consultation_notes
 * — e, mesmo que tocasse, a política staff_only esconderia (US-016 "nem no JSON da API").
 * Recusa o contexto da nutricionista (devolveria as orientações de todos os pacientes) e audita a leitura.
 */
export async function orientacoesDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<{ data: string; orientacoes: string }[]> {
  const patientId = ctx.role === 'paciente' ? ctx.patientId : undefined;
  if (!patientId) throw new Error('orientacoesDoPaciente só roda em sessão de paciente');
  const r = await withTenant(
    ctx,
    async (tx) => {
      const linhas = await tx
        .select({ data: consultations.data, orientacoes: consultations.orientacoesPaciente })
        .from(consultations)
        .where(and(eq(consultations.patientId, patientId), isNotNull(consultations.orientacoesPaciente)))
        .orderBy(desc(consultations.data));
      if (linhas.length) await auditRead(tx, { entidade: 'atendimentos', entidadeId: null, patientId });
      return linhas;
    },
    db,
  );
  return r.map((x) => ({ data: x.data, orientacoes: x.orientacoes ?? '' }));
}
```

Em `src/modules/pacientes/antropometria.ts`:

1. Imports: `consultations` de `@/db/schema`; `MSG_ATENDIMENTO` de `./atendimentos`.
2. `EntradaAntropometria` ganha `consultationId?: string | null;` e `entradaDoFormulario` devolve também `consultationId: v.consultationId || null,`.
3. Em `registrarAntropometria`, logo depois de `const p = await carregarPacienteParaEscrita(tx, patientId);`:

```ts
      const consultationId = input.consultationId || null;
      if (consultationId) {
        const [c] = idValido(consultationId)
          ? await tx.select({ id: consultations.id }).from(consultations).where(and(eq(consultations.id, consultationId), eq(consultations.patientId, p.id)))
          : [];
        if (!c) throw new AntropometriaError({ geral: MSG_ATENDIMENTO.naoEncontrado });
      }
```

e acrescentar `consultationId,` ao `values({…})` do `insert`.

Run: `pnpm test src/modules/pacientes`
Expected: PASS.

- [ ] **Step 4: Telas** — `src/app/painel/pacientes/[id]/atendimentos/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AtendimentoError, atualizarAtendimento, registrarAtendimento } from '@/modules/pacientes/atendimentos';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type AtendimentoState = { erros?: Record<string, string>; valores?: Record<string, string>; ok?: boolean };

const valoresDo = (f: FormData) => ({ data: String(f.get('data') ?? ''), notasPrivadas: String(f.get('notasPrivadas') ?? ''), orientacoes: String(f.get('orientacoes') ?? '') });

function tratar(e: unknown, valores: Record<string, string>): AtendimentoState {
  if (e instanceof AtendimentoError) return { erros: e.erros, valores };
  if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
  if (e instanceof PacienteNaoEncontradoError) notFound();
  throw e;
}

export async function registrarAtendimentoAction(patientId: string, _prev: AtendimentoState, formData: FormData): Promise<AtendimentoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/atendimentos`);
  const valores = valoresDo(formData);
  let id: string;
  try {
    id = await registrarAtendimento(ctx, tenant, patientId, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  redirect(`/painel/pacientes/${patientId}/atendimentos/${id}`);
}

export async function atualizarAtendimentoAction(patientId: string, id: string, _prev: AtendimentoState, formData: FormData): Promise<AtendimentoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/atendimentos/${id}`);
  const valores = valoresDo(formData);
  try {
    await atualizarAtendimento(ctx, tenant, patientId, id, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  revalidatePath(`/painel/pacientes/${patientId}/atendimentos`, 'layout');
  return { ok: true };
}
```

`src/app/painel/pacientes/[id]/atendimentos/atendimento-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import type { AtendimentoState } from './actions';

type Props = {
  acao: (prev: AtendimentoState, formData: FormData) => Promise<AtendimentoState>;
  inicial: { data: string; notasPrivadas: string; orientacoes: string };
  hoje: string;
  botao: string;
  somenteLeitura: boolean;
};

export function AtendimentoForm({ acao, inicial, hoje, botao, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<AtendimentoState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  const aria = (k: string) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) => e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{e[k]}</p>;
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={somenteLeitura} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="data" className="block font-medium">Data do atendimento</label>
          <input id="data" name="data" type="date" max={hoje} defaultValue={v.data} className="rounded border p-2" {...aria('data')} />
          {erro('data')}
        </div>
        <div className="space-y-1">
          <label htmlFor="notasPrivadas" className="block font-medium">Notas privadas</label>
          <p id="notasPrivadas-dica" className="text-sm text-zinc-700">Só você vê. O paciente nunca vê estas notas.</p>
          <textarea id="notasPrivadas" name="notasPrivadas" rows={6} maxLength={20000} defaultValue={v.notasPrivadas} className="w-full rounded border p-2"
            aria-invalid={e.notasPrivadas ? true : undefined} aria-describedby={e.notasPrivadas ? 'notasPrivadas-dica notasPrivadas-erro' : 'notasPrivadas-dica'} />
          {erro('notasPrivadas')}
        </div>
        <div className="space-y-1">
          <label htmlFor="orientacoes" className="block font-medium">Orientações ao paciente</label>
          <p id="orientacoes-dica" className="text-sm text-zinc-700">O paciente vê estas orientações no portal.</p>
          <textarea id="orientacoes" name="orientacoes" rows={4} maxLength={5000} defaultValue={v.orientacoes} className="w-full rounded border p-2"
            aria-invalid={e.orientacoes ? true : undefined} aria-describedby={e.orientacoes ? 'orientacoes-dica orientacoes-erro' : 'orientacoes-dica'} />
          {erro('orientacoes')}
        </div>
      </fieldset>
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      {state.ok && <p role="status">Atendimento salvo.</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{botao}</button>}
    </form>
  );
}
```

`src/app/painel/pacientes/[id]/atendimentos/page.tsx`

```tsx
import Link from 'next/link';
import { listarAtendimentos } from '@/modules/pacientes/atendimentos';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';
import { registrarAtendimentoAction } from './actions';
import { AtendimentoForm } from './atendimento-form';

export const dynamic = 'force-dynamic';

export default async function AtendimentosPage({ params }: PageProps<'/painel/pacientes/[id]/atendimentos'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarAtendimentos(ctx, paciente.id);
  const hoje = hojeNoFuso(tenant.fuso);
  return (
    <div className="space-y-8">
      {paciente.status !== 'bloqueado' && (
        <section aria-labelledby="novo-atendimento" className="max-w-3xl space-y-3">
          <h2 id="novo-atendimento" className="text-lg font-semibold">Novo atendimento</h2>
          <AtendimentoForm acao={registrarAtendimentoAction.bind(null, paciente.id)} inicial={{ data: hoje, notasPrivadas: '', orientacoes: '' }} hoje={hoje} botao="Registrar atendimento" somenteLeitura={false} />
        </section>
      )}
      <section aria-labelledby="atendimentos" className="space-y-2">
        <h2 id="atendimentos" className="text-lg font-semibold">Atendimentos</h2>
        {lista.length === 0 ? (
          <p>Nenhum atendimento registrado.</p>
        ) : (
          <ul className="divide-y">
            {lista.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/painel/pacientes/${paciente.id}/atendimentos/${a.id}`} className="underline">{formatarData(a.data)}</Link>
                {a.orientacoesPaciente && <p className="line-clamp-2 text-sm text-zinc-700">{a.orientacoesPaciente}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

`src/app/painel/pacientes/[id]/atendimentos/[atendimentoId]/page.tsx`

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buscarAtendimento } from '@/modules/pacientes/atendimentos';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../prontuario';
import { atualizarAtendimentoAction } from '../actions';
import { AtendimentoForm } from '../atendimento-form';

export const dynamic = 'force-dynamic';

export default async function AtendimentoPage({ params }: PageProps<'/painel/pacientes/[id]/atendimentos/[atendimentoId]'>) {
  const { id, atendimentoId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const a = await buscarAtendimento(ctx, paciente.id, atendimentoId);
  if (!a) notFound();
  const base = `/painel/pacientes/${paciente.id}`;
  return (
    <div className="grid gap-8 md:grid-cols-3">
      <section aria-labelledby="atendimento-titulo" className="space-y-3 md:col-span-2">
        <h2 id="atendimento-titulo" className="text-lg font-semibold">{`Atendimento de ${formatarData(a.data)}`}</h2>
        <AtendimentoForm
          acao={atualizarAtendimentoAction.bind(null, paciente.id, a.id)}
          inicial={{ data: a.data, notasPrivadas: a.notasPrivadas ?? '', orientacoes: a.orientacoesPaciente ?? '' }}
          hoje={hojeNoFuso(tenant.fuso)}
          botao="Salvar atendimento"
          somenteLeitura={paciente.status === 'bloqueado'}
        />
      </section>
      <nav aria-labelledby="atalhos" className="space-y-2">
        <h2 id="atalhos" className="text-lg font-semibold">Neste atendimento</h2>
        <ul className="space-y-1">
          <li><Link href={`${base}/anamnese`} className="underline">Anamnese</Link></li>
          <li><Link href={`${base}/antropometria?atendimento=${a.id}`} className="underline">Antropometria</Link></li>
          <li><Link href={`${base}/gasto-energetico`} className="underline">Gasto energético</Link></li>
        </ul>
      </nav>
    </div>
  );
}
```

Antropometria ligada ao atendimento:
- `src/app/painel/pacientes/[id]/antropometria/page.tsx`: aceitar `searchParams` (`PageProps` já traz), ler `const { atendimento } = await searchParams;` e passar `consultationId={typeof atendimento === 'string' ? atendimento : undefined}` ao `AntropometriaForm`.
- `antropometria-form.tsx`: nova prop `consultationId?: string` e, dentro do `<form>`, `{consultationId && <input type="hidden" name="consultationId" value={consultationId} />}` e `{consultationId && <p className="text-sm text-zinc-700">Esta avaliação fica ligada ao atendimento.</p>}`.

Em `abas.tsx`, acrescentar antes de `historico`: `{ seg: 'atendimentos', rotulo: 'Atendimentos' },`.

- [ ] **Step 5: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/db drizzle/0027_atendimentos.sql drizzle/0028_rls_atendimentos.sql drizzle/meta test/isolamento.test.ts \
  src/modules/pacientes src/modules/plataforma/audit.ts src/app/painel/pacientes
git commit -m "feat(pacientes): atendimentos com notas privadas em tabela staff_only, orientações ao paciente e atalhos (P03-09)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Exames — laudo (PDF/JPEG/PNG até 20 MB) com URL assinada e valores por marcador (P03-08)

**Files:**
- Create: `drizzle/0029_exames.sql` (gerada), `drizzle/0030_rls_exames.sql` (custom), `src/modules/pacientes/exames-constantes.ts`, `src/modules/pacientes/exames.ts`, `src/modules/pacientes/exames.test.ts`, `src/app/api/painel/pacientes/[id]/exames/route.ts`, `src/app/api/painel/pacientes/[id]/exames/route.test.ts`, `src/app/painel/pacientes/[id]/exames/page.tsx`, `src/app/painel/pacientes/[id]/exames/actions.ts`, `src/app/painel/pacientes/[id]/exames/exame-form.tsx`
- Modify: `src/db/schema/pacientes.ts`, `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts`, `src/modules/plataforma/armazenamento.ts` e `armazenamento.test.ts` (`registrar`, `naMesmaTransacao`, `removerAntesDoCommit`), `src/app/api/arquivos/route.ts` e `route.test.ts` (PDF como anexo), `CLAUDE.md` (regra 9), `src/app/painel/pacientes/[id]/abas.tsx`

**Interfaces:**
- Consumes: `salvarArquivo`, `apagarArquivo`, `TipoNaoPermitidoError`, `CotaEsgotadaError`, `MSG_COTA_ESGOTADA` (`@/modules/plataforma/armazenamento`); `storedFiles` (schema); `signFileUrl`, `verifyFileUrl` (`@/lib/signed-url`); `lerCorpoLimitado`, `CorpoGrandeError` (`@/lib/corpo`); `requireApiNutri`; `getEnv`; `carregarPacienteParaEscrita`, `idValido` (Tarefa 1); `dataValida`, `hojeNoFuso`, `formatarData` (Tarefa 1); `lerDecimal`, `formatarDecimal` (Tarefa 6); `auditRead`; `ConfirmarBotao` (Tarefa 7); `carregarProntuario`.
- Produces:
  - Schema: `exams` 🔒 (`data`, `titulo`, `arquivo_path` → `stored_files.caminho` `ON DELETE SET NULL`, `valores` jsonb), `type ExamRow`.
  - `@/modules/pacientes/exames`: `EXAME_MAX_BYTES`, `MSG_EXAME`, `type ValorExame`, `class ExameError { erros }`, `lerValores(bruto): ValorExame[] | null`, `criarExame(ctx, tenant, patientId, input, deps?): Promise<string>`, `excluirExame(ctx, patientId, id, deps?): Promise<boolean>`, `listarExames(ctx, patientId, db?): Promise<ExamRow[]>` (audita), `type SerieMarcador = { nome; unidade; pontos: { data; valor }[] }`, `agruparMarcadores(exames): SerieMarcador[]`, `marcadoresDoPaciente(ctx, patientId, db?)`. A Tarefa 12 usa `marcadoresDoPaciente`; a 13, os `arquivo_path`.
  - Rota `POST /api/painel/pacientes/[id]/exames` (multipart: `titulo`, `data`, `valores` em JSON, `arquivo` opcional) → `{ ok: true, id }` ou `{ erros }` com 400/404/409/413/415/507.

- [ ] **Step 1: Tabela** — acrescentar ao `src/db/schema/pacientes.ts` (import: `storedFiles` de `./platform`):

```ts
/** US-015. O laudo é um stored_files (cota, URL assinada); apagar o arquivo pela API de armazenamento solta o vínculo sozinho. */
export const exams = pgTable(
  'exams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    titulo: text('titulo').notNull(),
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    valores: jsonb('valores').$type<{ nome: string; valor: number; unidade: string | null; referencia: string | null }[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'exams_paciente_fk' }),
    check('exams_titulo_tamanho', sql`char_length(${t.titulo}) between 1 and 120`),
    index('exams_paciente_data_idx').on(t.tenantId, t.patientId, t.data),
  ],
);

export type ExamRow = typeof exams.$inferSelect;
```

Run: `pnpm db:generate --name exames` → `drizzle/0029_exames.sql` (com a FK `exams_arquivo_path_stored_files_caminho_fk … ON DELETE set null`).

Run: `pnpm drizzle-kit generate --custom --name rls_exames` e preencher `drizzle/0030_rls_exames.sql`:

```sql
SELECT app_enable_tenant_rls('exams');
--> statement-breakpoint
SELECT app_enable_patient_rls('exams');
--> statement-breakpoint
SELECT app_enable_audit('exams', 'exames');
```

`test/isolamento.test.ts`, no `FABRICAS`:

```ts
  exams: (t, p) => sql`insert into exams (tenant_id, patient_id, data, titulo) values (${t}, ${p}, '2026-01-01', 'Iso')`,
```

`src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `exames: 'Exames',`.

Run: `pnpm test src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 2: Testes que falham do serviço** — `src/modules/pacientes/exames.test.ts`

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { exams, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { signFileUrl, verifyFileUrl } from '@/lib/signed-url';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';
import { agruparMarcadores, criarExame, EXAME_MAX_BYTES, ExameError, excluirExame, lerValores, listarExames, marcadoresDoPaciente, MSG_EXAME } from './exames';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-exames-'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, dataDir };
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const PDF = (bytes: number) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(bytes - 9, 0x20)]);
const usado = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0].armazenamentoBytes;
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ExameError) return e.erros;
    throw e;
  }
  throw new Error('esperava ExameError');
};

describe('exames (US-015)', () => {
  it('"Anexar laudo": PDF de 3 MB com título e data vai para /data e só sai por URL assinada de 5 min', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: [], arquivo: PDF(3 * 1024 * 1024) }, deps);
    const [e] = await listarExames(T.ctx, p.id, app.db);
    expect(e).toMatchObject({ id, titulo: 'Hemograma', data: '2026-09-01' });
    expect(e.arquivoPath).toMatch(new RegExp(`^${T.tenantId}/exame/[0-9a-f-]{36}\\.pdf$`));
    expect(readFileSync(path.join(dataDir, e.arquivoPath!)).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await usado(T.tenantId)).toBe(3 * 1024 * 1024);
    const url = new URL(signFileUrl(e.arquivoPath!, { now }), 'http://x');
    expect(verifyFileUrl(url.searchParams, { now: new Date(now.getTime() + 299_000) })).toMatchObject({ ok: true });
    expect(verifyFileUrl(url.searchParams, { now: new Date(now.getTime() + 301_000) })).toEqual({ ok: false, motivo: 'expirado' });
  });

  it('"Arquivo inválido": .exe ou PDF de 25 MB → "Envie PDF, JPEG ou PNG de até 20 MB" e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1000)]);
    expect(await erros(criarExame(T.ctx, T.tenant, p.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: exe }, deps))).toEqual({ arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB' });
    expect(await erros(criarExame(T.ctx, T.tenant, p.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: PDF(EXAME_MAX_BYTES + 1) }, deps))).toEqual({ arquivo: MSG_EXAME.arquivo });
    expect(await listarExames(T.ctx, p.id, app.db)).toEqual([]);
    expect(await usado(T.tenantId)).toBe(0);
  });

  it('valores sem laudo; linhas vazias somem; valor não numérico é recusado', async () => {
    expect(lerValores([{ nome: ' Glicemia de jejum ', valor: '110', unidade: 'mg/dL', referencia: '70–99' }, { nome: '', valor: '', unidade: '', referencia: '' }])).toEqual([
      { nome: 'Glicemia de jejum', valor: 110, unidade: 'mg/dL', referencia: '70–99' },
    ]);
    expect(lerValores([{ nome: 'Glicemia', valor: 'alta' }])).toBeNull();
    expect(lerValores([{ nome: 'Glicemia', valor: '9'.repeat(400) }])).toBeNull(); // Infinity não entra (viraria null no jsonb)
    expect(lerValores([{ nome: '', valor: '10' }])).toBeNull();
    expect(lerValores('lixo')).toBeNull();
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await erros(criarExame(T.ctx, T.tenant, p.id, { titulo: '', data: '2026-10-09', valores: [{ nome: 'G', valor: 'x' }], arquivo: null }, deps))).toEqual({
      titulo: MSG_EXAME.titulo,
      data: MSG_EXAME.futuro,
      valores: MSG_EXAME.valores,
    });
  });

  it('"Valores e gráfico": Glicemia de jejum 110 em 01/06 e 95 em 01/09 → uma série com 2 pontos em ordem cronológica', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: ' glicemia de jejum ', valor: '95', unidade: 'mg/dL' }], arquivo: null }, deps);
    await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Rotina', data: '2026-06-01', valores: [{ nome: 'Glicemia de jejum', valor: '110', unidade: 'mg/dL' }, { nome: 'HbA1c', valor: '5,9', unidade: '%' }], arquivo: null }, deps);
    const series = await marcadoresDoPaciente(T.ctx, p.id, app.db);
    expect(series).toEqual([
      { nome: 'Glicemia de jejum', unidade: 'mg/dL', pontos: [{ data: '2026-06-01', valor: 110 }, { data: '2026-09-01', valor: 95 }] },
      { nome: 'HbA1c', unidade: '%', pontos: [{ data: '2026-06-01', valor: 5.9 }] },
    ]);
    expect(agruparMarcadores([])).toEqual([]);
    // mesma glicemia em outra unidade é outra série (não mistura mg/dL com mmol/L)
    const mistas = agruparMarcadores([
      { data: '2026-06-01', valores: [{ nome: 'Glicemia', valor: 110, unidade: 'mg/dL', referencia: null }] },
      { data: '2026-09-01', valores: [{ nome: 'glicemia', valor: 5.3, unidade: 'mmol/L', referencia: null }] },
    ]);
    expect(mistas.map((m) => [m.unidade, m.pontos.length])).toEqual([['mg/dL', 1], ['mmol/L', 1]]);
  });

  it('excluir apaga o laudo do disco e devolve a cota; apagar o arquivo pela API solta o vínculo (FK SET NULL)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarExame(T.ctx, T.tenant, p.id, { titulo: 'A', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps);
    expect(await excluirExame(T.ctx, p.id, id, deps)).toBe(true);
    expect(await usado(T.tenantId)).toBe(0);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    const id2 = await criarExame(T.ctx, T.tenant, p.id, { titulo: 'B', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps);
    const [e2] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, id2)), app.db);
    await apagarArquivo(T.ctx, { caminho: e2.arquivoPath! }, { db: app.db, dataDir });
    expect((await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, id2)), app.db))[0].arquivoPath).toBeNull();
  });

  it('paciente de outro tenant ou bloqueado: recusado antes de gravar o arquivo', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(criarExame(A.ctx, A.tenant, pB.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(criarExame(A.ctx, A.tenant, bloqueado.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await usado(A.tenantId)).toBe(0);
  });
});
```

Run: `pnpm test src/modules/pacientes/exames.test.ts`
Expected: FAIL — `Cannot find module './exames'`.

- [ ] **Step 2b: Arquivo e registro na mesma transação** — o laudo e o exame (e, na Tarefa 14, o ZIP e o pedido de exportação) precisam nascer e morrer juntos: com duas transações, uma queda entre elas deixa um `stored_files` sem dono, que ocupa cota para sempre e escapa da anonimização (a Tarefa 13 acha os anexos pelo registro do paciente). Em `src/modules/plataforma/armazenamento.ts`:

1. Import: `type Tx` de `@/db/client` (junto de `getDb`, `type Db`).
2. `salvarArquivo` ganha o campo opcional `registrar` no `input`: roda **dentro** da transação que reserva a cota, depois do INSERT em `stored_files` e antes de o arquivo ir para o disco. Se ele lançar, nada fica (nem registro, nem arquivo, nem cota). Trocar a assinatura e o trecho do `insert` por:

```ts
export async function salvarArquivo(
  ctx: TenantContext,
  input: {
    tipo: TipoDeArquivo;
    conteudo: Buffer;
    permitidos: readonly TipoArquivo['ext'][];
    /** Grava o registro que aponta para o arquivo (exame, exportação) na mesma transação. */
    registrar?: (tx: Tx, arquivo: ArquivoSalvo) => Promise<void>;
  },
  deps: Deps = {},
): Promise<ArquivoSalvo> {
```

```ts
        await tx
          .insert(storedFiles)
          .values({ id, tenantId: ctx.tenantId, tipo: input.tipo, caminho, bytes, mime: real.mime, criadoPor: ctx.actorUserId ?? null });
        const arquivo = { id, caminho, bytes, mime: real.mime };
        if (input.registrar) await input.registrar(tx, arquivo);
        await mkdir(path.dirname(destino), { recursive: true, mode: 0o750 });
        await writeFile(tmp, input.conteudo, { mode: 0o640, flag: 'wx' });
        await rename(tmp, destino);
        gravado = true;
        return arquivo;
```

3. `apagarArquivo` ganha, em `deps`, `naMesmaTransacao?: (tx: Tx) => Promise<boolean>` (roda antes do DELETE; `false` desiste de tudo — o exame já não existia) e `removerAntesDoCommit?: boolean` (a anonimização da Tarefa 13 precisa saber que o arquivo saiu do disco: com a opção, o `rm` roda dentro da transação e uma falha desfaz o DELETE, para tentar de novo no dia seguinte). Trocar a função inteira por:

```ts
/**
 * Apaga o registro e devolve o espaço; por padrão o arquivo sai do disco depois do commit (falha no `rm`
 * só vira aviso de arquivo órfão). `removerAntesDoCommit`: o `rm` roda na transação e, se falhar, nada é apagado.
 */
export async function apagarArquivo(
  ctx: TenantContext,
  filtro: { id: string } | { caminho: string },
  deps: Deps & { naMesmaTransacao?: (tx: Tx) => Promise<boolean>; removerAntesDoCommit?: boolean } = {},
): Promise<boolean> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  const onde = 'id' in filtro ? eq(storedFiles.id, filtro.id) : eq(storedFiles.caminho, filtro.caminho);
  const apagado = await withTenant(
    ctx,
    async (tx) => {
      if (deps.naMesmaTransacao && !(await deps.naMesmaTransacao(tx))) return null;
      const [row] = await tx.delete(storedFiles).where(onde).returning({ caminho: storedFiles.caminho, bytes: storedFiles.bytes });
      if (!row) return null;
      await tx
        .update(tenants)
        .set({ armazenamentoBytes: sql`greatest(${tenants.armazenamentoBytes} - ${row.bytes}, 0)` })
        .where(eq(tenants.id, ctx.tenantId));
      if (deps.removerAntesDoCommit) await rm(resolverCaminho(dataDir, row.caminho), { force: true });
      return row;
    },
    db,
  );
  if (!apagado) return false;
  if (!deps.removerAntesDoCommit) {
    await rm(resolverCaminho(dataDir, apagado.caminho), { force: true }).catch((err: unknown) =>
      logger.warn({ err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId }, 'arquivo órfão no disco'),
    );
  }
  return true;
}
```

Acrescentar ao `src/modules/plataforma/armazenamento.test.ts` (import `mkdirSync` de `node:fs` e `sql` de `drizzle-orm`, junto dos existentes):

```ts
describe('arquivo e registro na mesma transação (P03, Tarefa 11)', () => {
  it('registrar que falha desfaz tudo: nem stored_files, nem arquivo, nem cota', async () => {
    const ctx = await novoTenant();
    let caminho = '';
    await expect(
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'], registrar: async (_tx, a) => { caminho = a.caminho; throw new Error('exame recusado'); } }, deps),
    ).rejects.toThrow('exame recusado');
    expect(existsSync(path.join(dataDir, caminho))).toBe(false);
    expect(await withTenant(ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    expect(await usado(ctx.tenantId)).toBe(0);
  });
  it('registrar grava na mesma transação que reserva a cota', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'], registrar: async (tx, arq) => {
      const [n] = (await tx.execute(sql`select count(*)::int as n from stored_files where caminho = ${arq.caminho}`)).rows as { n: number }[];
      expect(n.n).toBe(1); // já visível dentro da transação
    } }, deps);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(true);
  });
  it('naMesmaTransacao = false desiste: o arquivo e a cota ficam', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'] }, deps);
    expect(await apagarArquivo(ctx, { id: a.id }, { ...deps, naMesmaTransacao: async () => false })).toBe(false);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(true);
    expect(await usado(ctx.tenantId)).toBe(108);
  });
  it('removerAntesDoCommit: se o rm falha, o registro continua (a anonimização tenta de novo)', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'] }, deps);
    const alvo = path.join(dataDir, a.caminho);
    rmSync(alvo);
    mkdirSync(path.join(alvo, 'x'), { recursive: true }); // um diretório não vazio no lugar: rm sem recursive falha
    await expect(apagarArquivo(ctx, { id: a.id }, { ...deps, removerAntesDoCommit: true })).rejects.toThrow();
    expect(await withTenant(ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, a.id)), app.db)).toHaveLength(1);
    rmSync(alvo, { recursive: true });
    expect(await apagarArquivo(ctx, { id: a.id }, { ...deps, removerAntesDoCommit: true })).toBe(true); // ENOENT com force: segue
  });
});
```

Run: `pnpm test src/modules/plataforma/armazenamento.test.ts`
Expected: PASS (os testes antigos seguem iguais: sem as opções novas, nada muda).

No CLAUDE.md, na regra 9, trocar "cota reservada na transação." por "cota reservada na transação; o registro que aponta para o arquivo (exame, exportação) é gravado no `registrar` de `salvarArquivo` e apagado no `naMesmaTransacao` de `apagarArquivo`, nunca numa transação separada."

- [ ] **Step 3: Implementar o serviço** — primeiro as constantes que o formulário (navegador) também usa, sem dependência de servidor (mesmo padrão de `marca-constantes.ts` do Plano 02): `src/modules/pacientes/exames-constantes.ts`

```ts
/** Limite e mensagens de exame que o formulário (navegador) também usa. */
export const EXAME_MAX_BYTES = 20 * 1024 * 1024; // US-015

export const MSG_EXAME = {
  arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB',
  titulo: 'Informe o título do exame',
  data: 'Informe a data do exame',
  futuro: 'A data não pode ser no futuro',
  valores: 'Confira os valores: informe nome e valor numérico',
  ocupado: 'Tente novamente em alguns instantes.', // mesmo texto do logo ocupado (Plano 02)
} as const;
```

`src/modules/pacientes/exames.ts`

```ts
import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { exams, type ExamRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { lerDecimal } from '@/lib/numero';
import { apagarArquivo, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido } from './base';
import { dataValida, hojeNoFuso } from './datas';
import { EXAME_MAX_BYTES, MSG_EXAME } from './exames-constantes';

export { EXAME_MAX_BYTES, MSG_EXAME };

export type ValorExame = { nome: string; valor: number; unidade: string | null; referencia: string | null };

export class ExameError extends Error {
  override name = 'ExameError';
  constructor(readonly erros: Record<string, string>) {
    super('Exame inválido');
  }
}

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Linhas de valores do formulário. Linha toda vazia é ignorada; nome sem valor numérico (ou o contrário) → null. */
export function lerValores(bruto: unknown): ValorExame[] | null {
  if (!Array.isArray(bruto)) return null;
  const out: ValorExame[] = [];
  for (const l of bruto.slice(0, 50) as Record<string, unknown>[]) {
    const nome = texto(l?.nome, 80);
    const valorTxt = l?.valor;
    const vazio = !nome && (valorTxt === undefined || valorTxt === '' || valorTxt === null);
    if (vazio) continue;
    const valor = lerDecimal(valorTxt);
    // isFinite, não só isNaN: '9'.repeat(400) vira Infinity, que o jsonb gravaria como null
    if (!nome || typeof valor !== 'number' || !Number.isFinite(valor)) return null;
    out.push({ nome, valor, unidade: texto(l.unidade, 20) || null, referencia: texto(l.referencia, 80) || null });
  }
  return out;
}

type Entrada = { titulo: unknown; data: unknown; valores: unknown; arquivo: Buffer | null };

/**
 * US-015. Ordem: valida tudo → confere o paciente (barato, antes de mexer em arquivo) → grava arquivo e
 * exame na MESMA transação (`registrar` de salvarArquivo: tipo pelo conteúdo, cota reservada, exame
 * inserido antes de o arquivo ir para o disco). Uma falha no meio não deixa laudo sem exame.
 */
export async function criarExame(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  input: Entrada,
  deps: { db?: Db; now?: Date; dataDir?: string } = {},
): Promise<string> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const erros: Record<string, string> = {};
  const titulo = texto(input.titulo, 120);
  if (!titulo) erros.titulo = MSG_EXAME.titulo;
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_EXAME.data;
  else if (data > hojeNoFuso(tenant.fuso, now)) erros.data = MSG_EXAME.futuro;
  const valores = lerValores(input.valores);
  if (!valores) erros.valores = MSG_EXAME.valores;
  if (input.arquivo && input.arquivo.length > EXAME_MAX_BYTES) erros.arquivo = MSG_EXAME.arquivo;
  if (Object.keys(erros).length || !valores) throw new ExameError(erros);

  await withTenant(ctx, (tx) => carregarPacienteParaEscrita(tx, patientId), db);
  const inserir = async (tx: Tx, arquivoPath: string | null) => {
    const p = await carregarPacienteParaEscrita(tx, patientId); // de novo, na transação que grava (pode ter sido bloqueado)
    const [e] = await tx
      .insert(exams)
      .values({ tenantId: ctx.tenantId, patientId: p.id, data, titulo, arquivoPath, valores, createdAt: now, updatedAt: now })
      .returning({ id: exams.id });
    return e.id;
  };
  if (!input.arquivo) return withTenant(ctx, (tx) => inserir(tx, null), db);
  let id = '';
  try {
    await salvarArquivo(
      ctx,
      { tipo: 'exame', conteudo: input.arquivo, permitidos: ['pdf', 'jpg', 'png'], registrar: async (tx, a) => void (id = await inserir(tx, a.caminho)) },
      { db, dataDir: deps.dataDir },
    );
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new ExameError({ arquivo: MSG_EXAME.arquivo });
    throw e; // CotaEsgotadaError: quem chama traduz (RN-18)
  }
  return id;
}

export async function excluirExame(ctx: TenantContext, patientId: string, id: string, deps: { db?: Db; dataDir?: string } = {}): Promise<boolean> {
  const db = deps.db ?? getDb();
  if (!idValido(id)) return false;
  const doExame = and(eq(exams.id, id), eq(exams.patientId, patientId));
  const apagarExame = async (tx: Tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    return (await tx.delete(exams).where(doExame).returning({ id: exams.id })).length > 0;
  };
  const [atual] = await withTenant(ctx, (tx) => tx.select({ caminho: exams.arquivoPath }).from(exams).where(doExame), db);
  if (!atual) return false;
  // exame e laudo saem na mesma transação; o arquivo deixa o disco depois do commit
  if (atual.caminho) return apagarArquivo(ctx, { caminho: atual.caminho }, { db, dataDir: deps.dataDir, naMesmaTransacao: apagarExame });
  return withTenant(ctx, apagarExame, db);
}

export async function listarExames(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<ExamRow[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(exams).where(eq(exams.patientId, patientId)).orderBy(desc(exams.data), desc(exams.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'exames', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

export type SerieMarcador = { nome: string; unidade: string | null; pontos: { data: string; valor: number }[] };

/**
 * Um marcador por nome + unidade (sem diferenciar maiúsculas/espaços), pontos em ordem cronológica: glicemia em
 * mg/dL e em mmol/L são duas séries — misturadas, o gráfico sairia errado.
 */
export function agruparMarcadores(lista: Pick<ExamRow, 'data' | 'valores'>[]): SerieMarcador[] {
  const series = new Map<string, SerieMarcador>();
  const norm = (t: string | null) => (t ?? '').normalize('NFC').trim().toLowerCase();
  for (const e of [...lista].sort((a, b) => a.data.localeCompare(b.data))) {
    for (const v of e.valores) {
      const chave = `${norm(v.nome)}\u0000${norm(v.unidade)}`;
      const s = series.get(chave) ?? { nome: v.nome.trim(), unidade: v.unidade, pontos: [] };
      s.pontos.push({ data: e.data, valor: v.valor });
      series.set(chave, s);
    }
  }
  return [...series.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || norm(a.unidade).localeCompare(norm(b.unidade)));
}

export async function marcadoresDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<SerieMarcador[]> {
  return agruparMarcadores(await listarExames(ctx, patientId, db));
}
```

> O nome exibido é o da primeira ocorrência (a mais antiga); no teste, "Glicemia de jejum" de 01/06.

Run: `pnpm test src/modules/pacientes/exames.test.ts`
Expected: PASS.

- [ ] **Step 4: Upload por Route Handler** — teste `src/app/api/painel/pacientes/[id]/exames/route.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { listarExames } from '@/modules/pacientes/exames';
import { COTA_BYTES, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { novoPaciente } from '../../../../../../../test/pacientes';
import { criarEEntrar } from '../../../../../../../test/sessao';
import { POST } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function nutriComDpa() {
  const [t] = await db.insert(tenants).values({ slug: `ex-${randomUUID().slice(0, 8)}`, nomeExibicao: 'EX' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
function enviar(id: string, campos: Record<string, string | Blob>, cookie?: string, origin = 'http://localhost:3000') {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return POST(new Request(`http://localhost:3000/api/painel/pacientes/${id}/exames`, { method: 'POST', body: f, headers: { ...(cookie ? { cookie } : {}), origin } }), {
    params: Promise.resolve({ id }),
  });
}
const pdf = (n: number) => new Blob([Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n)])], { type: 'application/pdf' });

describe('POST /api/painel/pacientes/[id]/exames', () => {
  it('grava o exame com laudo e valores', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const r = await enviar(p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: JSON.stringify([{ nome: 'Glicemia', valor: '95', unidade: 'mg/dL' }]), arquivo: pdf(1000) }, A.cookie);
    expect(r.status).toBe(200);
    const [e] = await listarExames(A.ctx, p.id, db);
    expect(e).toMatchObject({ titulo: 'Hemograma', valores: [{ nome: 'Glicemia', valor: 95, unidade: 'mg/dL', referencia: null }] });
    expect(e.arquivoPath).toMatch(/\.pdf$/);
  });

  it('tipo errado 415 e grande demais 413, com a mensagem da spec; campos inválidos 400', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const exe = await enviar(p.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: new Blob([Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)])]) }, A.cookie);
    expect(exe.status).toBe(415);
    expect(await exe.json()).toEqual({ erros: { arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB' } });
    const grande = await enviar(p.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: pdf(21 * 1024 * 1024) }, A.cookie);
    expect(grande.status).toBe(413);
    expect(await grande.json()).toEqual({ erros: { arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB' } });
    const ruim = await enviar(p.id, { titulo: '', data: '2026-09-01', valores: 'nao-e-json' }, A.cookie);
    expect(ruim.status).toBe(400);
    expect(await ruim.json()).toMatchObject({ erros: { titulo: 'Informe o título do exame', valores: expect.any(String) } });
  });

  it('cota esgotada 507 com a mensagem do RN-18; paciente bloqueado 409; nada é gravado', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const bloqueado = await novoPaciente(db, A.ctx, { status: 'bloqueado' });
    const b = await enviar(bloqueado.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: pdf(1000) }, A.cookie);
    expect(b.status).toBe(409);
    await db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, A.ctx.tenantId));
    const cheio = await enviar(p.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: pdf(1000) }, A.cookie);
    expect(cheio.status).toBe(507);
    expect(await cheio.json()).toEqual({ erros: { arquivo: MSG_COTA_ESGOTADA } });
    expect(await listarExames(A.ctx, p.id, db)).toEqual([]);
  });

  it('paciente de outro tenant 404; sem sessão 401; outra origem 403', async () => {
    const A = await nutriComDpa();
    const B = await nutriComDpa();
    const pB = await novoPaciente(db, B.ctx);
    expect((await enviar(pB.id, { titulo: 'X', data: '2026-09-01', valores: '[]' }, A.cookie)).status).toBe(404);
    expect((await enviar(pB.id, { titulo: 'X', data: '2026-09-01', valores: '[]' })).status).toBe(401);
    expect((await enviar(pB.id, { titulo: 'X', data: '2026-09-01', valores: '[]' }, B.cookie, 'https://evil.example')).status).toBe(403);
  });
});
```

Run: `pnpm test src/app/api/painel/pacientes/[id]/exames/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

Implementar `src/app/api/painel/pacientes/[id]/exames/route.ts`:

```ts
import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { requireApiNutri, type ApiNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { criarExame, EXAME_MAX_BYTES, ExameError, MSG_EXAME } from '@/modules/pacientes/exames';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

// O multipart leva, além do arquivo, título, data, valores e as fronteiras
const LIMITE_CORPO = EXAME_MAX_BYTES + 256 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });

// Cada envio segura ~3 cópias de até 20 MB (corpo, FormData, Buffer do arquivo) numa VPS dividida com o CRM
// de produção: no máximo 2 por processo, como o "um logo por vez" do Plano 02 (T10-R1c)
const MAX_ENVIOS = 2;
let enviosEmAndamento = 0;

/** US-015: multipart (titulo, data, valores em JSON, arquivo opcional). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]/exames'>) {
  const origem = req.headers.get('origin');
  if (origem && origem !== new URL(getEnv().APP_URL).origin) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;

  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { arquivo: MSG_EXAME.arquivo } });
  if (enviosEmAndamento >= MAX_ENVIOS) return resposta(429, { erros: { geral: MSG_EXAME.ocupado } });
  enviosEmAndamento++;
  try {
    return await receber(req, acesso, id);
  } finally {
    enviosEmAndamento--;
  }
}

async function receber(req: Request, acesso: Extract<ApiNutri, { ok: true }>, id: string): Promise<Response> {
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO);
    // sem cópia: a visão aponta para o mesmo buffer do corpo
    form = await new Response(new Uint8Array(corpo.buffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erros: { arquivo: MSG_EXAME.arquivo } });
    return resposta(400, { erros: { geral: 'Formulário inválido.' } });
  }
  const arquivo = form.get('arquivo');
  const buf = arquivo instanceof Blob && arquivo.size > 0 ? Buffer.from(await arquivo.arrayBuffer()) : null;
  let valores: unknown = null;
  try {
    valores = JSON.parse(String(form.get('valores') ?? '[]'));
  } catch {
    valores = null; // vira o erro de "valores" na validação
  }
  try {
    const exameId = await criarExame(acesso.ctx, acesso.tenant, id, { titulo: form.get('titulo'), data: form.get('data'), valores, arquivo: buf });
    return resposta(200, { ok: true, id: exameId });
  } catch (e) {
    if (e instanceof ExameError) {
      const status = e.erros.arquivo ? (buf && buf.length > EXAME_MAX_BYTES ? 413 : 415) : 400;
      return resposta(status, { erros: e.erros });
    }
    if (e instanceof PacienteNaoEncontradoError) return resposta(404, { erros: { geral: 'Paciente não encontrado' } });
    if (e instanceof PacienteBloqueadoError) return resposta(409, { erros: { geral: e.message } });
    if (e instanceof CotaEsgotadaError) return resposta(507, { erros: { arquivo: MSG_COTA_ESGOTADA } });
    throw e;
  }
}
```

Run: `pnpm test src/app/api/painel/pacientes/[id]/exames/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Tela** — `src/app/painel/pacientes/[id]/exames/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { excluirExame } from '@/modules/pacientes/exames';

export async function excluirExameAction(patientId: string, id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/exames`);
  try {
    await excluirExame(ctx, patientId, id);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}
```

`src/app/painel/pacientes/[id]/exames/exame-form.tsx`

```tsx
'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { EXAME_MAX_BYTES, MSG_EXAME } from '@/modules/pacientes/exames-constantes';

type Linha = { chave: number; nome: string; valor: string; unidade: string; referencia: string };
const vazia = (chave: number): Linha => ({ chave, nome: '', valor: '', unidade: '', referencia: '' });

/** Envia por fetch (multipart) para o Route Handler: laudo de até 20 MB não cabe no limite das Server Actions. */
export function ExameForm({ patientId, hoje }: { patientId: string; hoje: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [linhas, setLinhas] = useState<Linha[]>([vazia(0)]);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);
  const mudar = (i: number, k: keyof Linha, v: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setOk(false);
    const fd = new FormData(ev.currentTarget);
    const arquivo = fd.get('arquivo');
    if (arquivo instanceof File && arquivo.size > EXAME_MAX_BYTES) return setErros({ arquivo: MSG_EXAME.arquivo });
    fd.set('valores', JSON.stringify(linhas.map(({ nome, valor, unidade, referencia }) => ({ nome, valor, unidade, referencia }))));
    setEnviando(true);
    try {
      const r = await fetch(`/api/painel/pacientes/${patientId}/exames`, { method: 'POST', body: fd });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Record<string, string> };
      if (!r.ok) return setErros(corpo.erros ?? { geral: 'Não foi possível salvar o exame. Tente de novo.' });
      setErros({});
      setLinhas([vazia(Date.now())]);
      form.current?.reset();
      setOk(true);
      router.refresh();
    } catch {
      setErros({ geral: 'Não foi possível salvar o exame. Tente de novo.' });
    } finally {
      setEnviando(false);
    }
  }

  const aria = (k: string) => (erros[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) => erros[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{erros[k]}</p>;
  return (
    <form ref={form} onSubmit={enviar} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="titulo" className="block font-medium">Título do exame</label>
          <input id="titulo" name="titulo" maxLength={120} className="w-full rounded border p-2" {...aria('titulo')} />
          {erro('titulo')}
        </div>
        <div className="space-y-1">
          <label htmlFor="data" className="block font-medium">Data do exame</label>
          <input id="data" name="data" type="date" max={hoje} defaultValue={hoje} className="rounded border p-2" {...aria('data')} />
          {erro('data')}
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="arquivo" className="block font-medium">Laudo (opcional)</label>
        <input id="arquivo" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" {...aria('arquivo')} />
        <p className="text-sm text-zinc-700">PDF, JPEG ou PNG de até 20 MB.</p>
        {erro('arquivo')}
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Valores</legend>
        {linhas.map((l, i) => (
          <div key={l.chave} className="grid gap-2 sm:grid-cols-5">
            {(
              [
                ['nome', `Marcador ${i + 1}`],
                ['valor', `Valor ${i + 1}`],
                ['unidade', `Unidade ${i + 1}`],
                ['referencia', `Referência ${i + 1}`],
              ] as const
            ).map(([k, rotulo]) => (
              <div key={k} className="space-y-1">
                <label htmlFor={`${k}-${l.chave}`} className="block text-sm">{rotulo}</label>
                <input id={`${k}-${l.chave}`} value={l[k]} onChange={(ev) => mudar(i, k, ev.target.value)} inputMode={k === 'valor' ? 'decimal' : undefined} className="w-full rounded border p-2" />
              </div>
            ))}
            <button type="button" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} className="self-end underline" aria-label={`Remover o valor ${i + 1}`}>Remover</button>
          </div>
        ))}
        <button type="button" onClick={() => setLinhas((ls) => [...ls, vazia(Date.now())])} className="rounded border px-3 py-1">Adicionar valor</button>
        {erro('valores')}
      </fieldset>
      {erro('geral')}
      {ok && <p role="status">Exame salvo.</p>}
      <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white">Salvar exame</button>
    </form>
  );
}
```

`src/app/painel/pacientes/[id]/exames/page.tsx`

```tsx
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { signFileUrl } from '@/lib/signed-url';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { listarExames } from '@/modules/pacientes/exames';
import { carregarProntuario } from '../prontuario';
import { excluirExameAction } from './actions';
import { ExameForm } from './exame-form';

export const dynamic = 'force-dynamic';

export default async function ExamesPage({ params }: PageProps<'/painel/pacientes/[id]/exames'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarExames(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado';
  return (
    <div className="space-y-8">
      {!bloqueado && (
        <section aria-labelledby="novo-exame" className="max-w-4xl space-y-3">
          <h2 id="novo-exame" className="text-lg font-semibold">Novo exame</h2>
          <ExameForm patientId={paciente.id} hoje={hojeNoFuso(tenant.fuso)} />
        </section>
      )}
      <section aria-labelledby="exames" className="space-y-4">
        <h2 id="exames" className="text-lg font-semibold">Exames</h2>
        {lista.length === 0 && <p>Nenhum exame registrado.</p>}
        {lista.map((e) => (
          <article key={e.id} aria-labelledby={`exame-${e.id}`} className="space-y-2 rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id={`exame-${e.id}`} className="font-semibold">{`${e.titulo} · ${formatarData(e.data)}`}</h3>
              <span className="flex gap-4">
                {e.arquivoPath && (
                  <a href={signFileUrl(e.arquivoPath)} rel="noreferrer" className="underline">Baixar laudo</a>
                )}
                {!bloqueado && (
                  <form action={excluirExameAction.bind(null, paciente.id, e.id)}>
                    <ConfirmarBotao mensagem="Excluir este exame e o laudo?" rotulo={`Excluir o exame ${e.titulo} de ${formatarData(e.data)}`}>Excluir</ConfirmarBotao>
                  </form>
                )}
              </span>
            </div>
            {e.valores.length > 0 && (
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{`Valores do exame ${e.titulo}`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Marcador</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Referência</th>
                  </tr>
                </thead>
                <tbody>
                  {e.valores.map((v) => (
                    <tr key={v.nome} className="border-t">
                      <td>{v.nome}</td>
                      <td>{`${String(v.valor).replace('.', ',')}${v.unidade ? ` ${v.unidade}` : ''}`}</td>
                      <td>{v.referencia ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
```

Em `abas.tsx`, acrescentar antes de `historico`: `{ seg: 'exames', rotulo: 'Exames' },`.

- [ ] **Step 5b: Laudo em PDF sai como download** — é o primeiro PDF que `/api/arquivos` serve, e a resposta leva `content-security-policy: default-src 'none'; sandbox`: o visualizador de PDF do Chrome não abre documento em sandbox (a aba fica em branco). Em vez de afrouxar a CSP, o PDF vai como anexo. Em `src/app/api/arquivos/route.ts`, trocar `'content-disposition': 'inline',` por:

```ts
      // PDF em sandbox não abre no visualizador do Chrome: baixa (a CSP continua fechada para imagem e PDF)
      'content-disposition': ext === 'pdf' ? 'attachment; filename="documento.pdf"' : 'inline',
```

Acrescentar ao `src/app/api/arquivos/route.test.ts`:

```ts
  it('PDF é servido como anexo (o visualizador do navegador não abre documento em sandbox)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `rota3-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Rota 3' }).returning();
    const a = await salvarArquivo({ tenantId: t.id, role: 'nutri' }, { tipo: 'exame', conteudo: Buffer.from('%PDF-1.7\nconteudo'), permitidos: ['pdf'] });
    const res = await get(signFileUrl(a.caminho));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="documento.pdf"');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });
```

Run: `pnpm test src/app/api/arquivos/route.test.ts` → PASS.

- [ ] **Step 6: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/db/schema/pacientes.ts drizzle/0029_exames.sql drizzle/0030_rls_exames.sql drizzle/meta test/isolamento.test.ts \
  src/modules/pacientes src/modules/plataforma/audit.ts src/modules/plataforma/armazenamento.ts src/modules/plataforma/armazenamento.test.ts \
  src/app/api/arquivos CLAUDE.md 'src/app/api/painel/pacientes/[id]/exames' src/app/painel/pacientes
git commit -m "feat(pacientes): exames com laudo validado pelo conteúdo, URL assinada, valores e séries por marcador (P03-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Evolução — gráficos de peso, IMC, %G, circunferências e marcadores de exame (P03-10)

**Files:**
- Create: `src/modules/pacientes/evolucao.ts`, `src/modules/pacientes/evolucao.test.ts`, `src/modules/pacientes/ui/grafico-linha.tsx`, `src/modules/pacientes/ui/grafico-linha.test.ts`, `src/app/painel/pacientes/[id]/evolucao/page.tsx`
- Modify: `src/app/painel/pacientes/[id]/abas.tsx`

**Interfaces:**
- Consumes: `listarAntropometrias` (Tarefa 7), `CIRCUNFERENCIAS` (Tarefa 7); `AnthropometryRow.consultationId` (Tarefa 10); `marcadoresDoPaciente`, `type SerieMarcador` (Tarefa 11); `formatarDecimal`, `arredondar` (Tarefa 6); `formatarData` (Tarefa 1); `type AnthropometryRow`.
- Produces:
  - `@/modules/pacientes/evolucao`: `type Ponto = { data: string; valor: number }`, `type SerieEvolucao = { id; rotulo; unidade; casas; pontos }`, `type Diferenca = { rotulo; primeiro: Ponto; ultimo: Ponto; texto: string }`, `seriesDasAvaliacoes(avaliacoes): SerieEvolucao[]`, `diferencas(series): Diferenca[]`, `formatarDiferenca(v, casas, unidade): string`, `casasDoMarcador(pontos): number`, `evolucaoDoPaciente(ctx, patientId, db?): Promise<{ avaliacoes: number; series; diferencas; marcadores: SerieMarcador[] }>`, `MSG_POUCOS_DADOS`.
  - `@/modules/pacientes/ui/grafico-linha`: `GraficoLinha({ id, titulo, unidade, casas, pontos })` — SVG no servidor, dica nativa por ponto, tabela de dados. O Plano 06 ("Minha evolução") reaproveita.

- [ ] **Step 1: Testes que falham** — `src/modules/pacientes/evolucao.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, type AnthropometryRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import { casasDoMarcador, diferencas, evolucaoDoPaciente, formatarDiferenca, seriesDasAvaliacoes } from './evolucao';
import { criarExame } from './exames';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const av = (data: string, pesoKg: number, extra: Partial<AnthropometryRow> = {}): AnthropometryRow => ({
  id: data, tenantId: 't', patientId: 'p', consultationId: null, data, pesoKg, alturaCm: 165, imc: Math.round((pesoKg / 1.65 ** 2) * 100) / 100,
  circunferencias: {}, dobrasMm: {}, protocolo: 'nenhum', densidade: null, percGordura: null, createdAt: new Date(), updatedAt: new Date(), ...extra,
});

describe('evolução (US-017)', () => {
  it('valor de exame mostra as casas que foram digitadas (até 3): 0,85 não vira 0,9, nem 5,95 vira 6,0', () => {
    const pts = (...v: number[]) => v.map((valor, i) => ({ data: `2026-0${i + 1}-01`, valor }));
    expect(casasDoMarcador(pts(110, 95))).toBe(0);
    expect(casasDoMarcador(pts(0.85, 1.2))).toBe(2);
    expect(casasDoMarcador(pts(5.95, 6))).toBe(2);
    expect(casasDoMarcador(pts(0.12345))).toBe(3);
  });

  it('séries em ordem cronológica: peso, IMC, %G (só onde houve) e cada circunferência medida', () => {
    const s = seriesDasAvaliacoes([
      av('2026-09-01', 69.2, { percGordura: 26.1, circunferencias: { cintura: 80 } }),
      av('2026-06-01', 72.4, { percGordura: 28.4, circunferencias: { cintura: 84, quadril: 100 } }),
      av('2026-07-01', 71, { circunferencias: {} }),
      av('2026-08-01', 70.1, { circunferencias: { cintura: 82 } }),
    ]);
    expect(s.map((x) => x.id)).toEqual(['peso', 'imc', 'perc_gordura', 'circ_cintura', 'circ_quadril']);
    expect(s[0].pontos.map((p) => p.data)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
    expect(s[2].pontos).toEqual([{ data: '2026-06-01', valor: 28.4 }, { data: '2026-09-01', valor: 26.1 }]);
    const d = diferencas(s);
    expect(d.find((x) => x.rotulo === 'Peso')?.texto).toBe('−3,2 kg');
    expect(d.find((x) => x.rotulo === 'Cintura')?.texto).toBe('−4,0 cm');
    expect(d.find((x) => x.rotulo === 'Quadril')).toBeUndefined(); // um ponto só não tem diferença
  });

  it('formatarDiferenca: sinal de menos tipográfico, mais explícito, zero sem sinal', () => {
    expect(formatarDiferenca(-3.2, 1, 'kg')).toBe('−3,2 kg');
    expect(formatarDiferenca(1, 1, 'kg')).toBe('+1,0 kg');
    expect(formatarDiferenca(0, 2, '')).toBe('0,00');
    expect(formatarDiferenca(-0.004, 2, '%')).toBe('0,00 %');
  });

  it('do banco: avaliações e marcadores do paciente, com a leitura auditada; outro tenant não vê nada', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const p = await novoPaciente(app.db, A.ctx);
    for (const [data, pesoKg] of [['2026-06-01', '72,4'], ['2026-09-01', '69,2']] as const) {
      await registrarAntropometria(A.ctx, A.tenant, p.id, entradaDoFormulario({ data, pesoKg, alturaCm: '165', protocolo: 'nenhum' }), deps);
    }
    await criarExame(A.ctx, A.tenant, p.id, { titulo: 'Rotina', data: '2026-06-01', valores: [{ nome: 'Glicemia de jejum', valor: '110', unidade: 'mg/dL' }], arquivo: null }, deps);
    const e = await evolucaoDoPaciente(A.ctx, p.id, app.db);
    expect(e.avaliacoes).toBe(2);
    expect(e.diferencas.find((d) => d.rotulo === 'Peso')?.texto).toBe('−3,2 kg');
    expect(e.marcadores.map((m) => m.nome)).toEqual(['Glicemia de jejum']);
    const leituras = await withTenant(A.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'ler'))), app.db);
    expect(new Set(leituras.map((l) => l.entidade))).toEqual(new Set(['antropometria', 'exames']));
    expect(await evolucaoDoPaciente(B.ctx, p.id, app.db)).toEqual({ avaliacoes: 0, series: [], diferencas: [], marcadores: [] });
  });
});
```

`src/modules/pacientes/ui/grafico-linha.test.ts`

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GraficoLinha } from './grafico-linha';

const render = (pontos: { data: string; valor: number }[]) =>
  renderToStaticMarkup(createElement(GraficoLinha, { id: 'glicemia', titulo: 'Glicemia de jejum', unidade: 'mg/dL', casas: 0, pontos }));

describe('GraficoLinha', () => {
  it('SVG acessível: título, dica por ponto (dd/mm/aaaa: valor unidade) e tabela com os dados', () => {
    const html = render([{ data: '2026-09-01', valor: 95 }, { data: '2026-06-01', valor: 110 }]);
    expect(html).toContain('role="img"');
    expect(html).toContain('<title id="glicemia-titulo">Glicemia de jejum (mg/dL)</title>');
    expect(html).toContain('<title>01/06/2026: 110 mg/dL</title>');
    expect(html).toContain('<title>01/09/2026: 95 mg/dL</title>');
    // pontos em ordem cronológica: o de junho vem antes na linha
    expect(html.indexOf('01/06/2026: 110')).toBeLessThan(html.indexOf('01/09/2026: 95'));
    expect(html).toContain('<caption');
    expect((html.match(/<tr>/g) ?? []).length).toBe(3); // cabeçalho + 2 linhas
  });
  it('valores iguais não quebram a escala (sem divisão por zero)', () => {
    const html = render([{ data: '2026-06-01', valor: 100 }, { data: '2026-09-01', valor: 100 }]);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });
});
```

Run: `pnpm test src/modules/pacientes/evolucao.test.ts src/modules/pacientes/ui/grafico-linha.test.ts`
Expected: FAIL — `Cannot find module './evolucao'` / `'./grafico-linha'`.

- [ ] **Step 2: Implementar as séries** — `src/modules/pacientes/evolucao.ts`

```ts
import { getDb, type Db } from '@/db/client';
import type { AnthropometryRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { arredondar, formatarDecimal } from '@/lib/numero';
import { CIRCUNFERENCIAS, listarAntropometrias } from './antropometria';
import { marcadoresDoPaciente, type SerieMarcador } from './exames';

export const MSG_POUCOS_DADOS = 'Registre mais uma avaliação para ver a evolução';

export type Ponto = { data: string; valor: number };
export type SerieEvolucao = { id: string; rotulo: string; unidade: string; casas: number; pontos: Ponto[] };
export type Diferenca = { rotulo: string; primeiro: Ponto; ultimo: Ponto; texto: string };

/** Uma série por medida, só com as datas em que ela foi medida; série sem ponto some. */
export function seriesDasAvaliacoes(avaliacoes: AnthropometryRow[]): SerieEvolucao[] {
  const asc = [...avaliacoes].sort((a, b) => a.data.localeCompare(b.data) || a.createdAt.getTime() - b.createdAt.getTime());
  const serie = (id: string, rotulo: string, unidade: string, casas: number, valor: (a: AnthropometryRow) => number | null | undefined): SerieEvolucao => ({
    id,
    rotulo,
    unidade,
    casas,
    pontos: asc.flatMap((a) => {
      const v = valor(a);
      return typeof v === 'number' ? [{ data: a.data, valor: v }] : [];
    }),
  });
  return [
    serie('peso', 'Peso', 'kg', 1, (a) => a.pesoKg),
    serie('imc', 'IMC', '', 2, (a) => a.imc),
    serie('perc_gordura', '% de gordura', '%', 2, (a) => a.percGordura),
    ...CIRCUNFERENCIAS.map((c) => serie(`circ_${c.id}`, c.rotulo, 'cm', 1, (a) => a.circunferencias[c.id])),
  ].filter((s) => s.pontos.length > 0);
}

/** Casas para exibir um marcador de exame: o maior número de decimais digitado nos pontos, com teto de 3 (a aba Exames mostra o valor exato). */
export function casasDoMarcador(pontos: Ponto[]): number {
  return Math.min(3, Math.max(0, ...pontos.map((p) => (String(p.valor).split('.')[1] ?? '').length)));
}

/** US-017: "−3,2 kg" (sinal de menos tipográfico), "+1,0 kg", "0,0 kg". */
export function formatarDiferenca(v: number, casas: number, unidade: string): string {
  const r = arredondar(v, casas);
  const sinal = r < 0 ? '−' : r > 0 ? '+' : '';
  return `${sinal}${formatarDecimal(Math.abs(r), casas)}${unidade ? ` ${unidade}` : ''}`;
}

/** Primeiro × último registro de cada série com 2 pontos ou mais. */
export function diferencas(series: SerieEvolucao[]): Diferenca[] {
  return series
    .filter((s) => s.pontos.length >= 2)
    .map((s) => {
      const primeiro = s.pontos[0];
      const ultimo = s.pontos[s.pontos.length - 1];
      return { rotulo: s.rotulo, primeiro, ultimo, texto: formatarDiferenca(ultimo.valor - primeiro.valor, s.casas, s.unidade) };
    });
}

/** Tudo o que a aba Evolução mostra. As leituras (antropometria, exames) são auditadas pelos serviços de origem. */
export async function evolucaoDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()) {
  const [avaliacoes, marcadores] = await Promise.all([listarAntropometrias(ctx, patientId, db), marcadoresDoPaciente(ctx, patientId, db)]);
  const series = seriesDasAvaliacoes(avaliacoes);
  return { avaliacoes: avaliacoes.length, series, diferencas: diferencas(series), marcadores: marcadores as SerieMarcador[] };
}
```

- [ ] **Step 3: Gráfico SVG** — `src/modules/pacientes/ui/grafico-linha.tsx`

```tsx
import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '../datas';

type Props = { id: string; titulo: string; unidade: string; casas: number; pontos: { data: string; valor: number }[] };

const L = 640;
const A = 220;
const M = { esq: 56, dir: 16, topo: 16, baixo: 32 };

/**
 * Linha de uma série só (o título nomeia a série; sem legenda). SVG renderizado no servidor, sem JS:
 * linha de 2 px, marcadores de 8 px com dica nativa (<title>) e área de toque maior; grade recessiva;
 * a tabela com os mesmos dados atende leitor de tela e impressão. Cor por classe (claro/escuro).
 */
export function GraficoLinha({ id, titulo, unidade, casas, pontos }: Props) {
  const asc = [...pontos].sort((a, b) => a.data.localeCompare(b.data));
  const tempo = asc.map((p) => Date.parse(`${p.data}T00:00:00Z`));
  const t0 = Math.min(...tempo);
  const t1 = Math.max(...tempo);
  const valores = asc.map((p) => p.valor);
  let v0 = Math.min(...valores);
  let v1 = Math.max(...valores);
  const folga = v1 === v0 ? Math.max(1, Math.abs(v0) * 0.05) : (v1 - v0) * 0.1;
  v0 -= folga;
  v1 += folga;
  const x = (t: number) => (t1 === t0 ? (M.esq + L - M.dir) / 2 : M.esq + ((t - t0) / (t1 - t0)) * (L - M.esq - M.dir));
  const y = (v: number) => M.topo + (1 - (v - v0) / (v1 - v0)) * (A - M.topo - M.baixo);
  const fmt = (v: number) => `${formatarDecimal(v, casas)}${unidade ? ` ${unidade}` : ''}`;
  const marcas = [v0 + folga, (v0 + v1) / 2, v1 - folga];
  const nome = unidade ? `${titulo} (${unidade})` : titulo;
  return (
    <figure className="space-y-2 text-zinc-700 dark:text-zinc-300">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-labelledby={`${id}-titulo ${id}-desc`} className="h-auto w-full max-w-2xl">
        <title id={`${id}-titulo`}>{nome}</title>
        <desc id={`${id}-desc`}>{`${asc.length} registros, de ${formatarData(asc[0].data)} a ${formatarData(asc[asc.length - 1].data)}.`}</desc>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={L - M.dir} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={M.esq - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="currentColor">{formatarDecimal(v, casas)}</text>
          </g>
        ))}
        <text x={x(t0)} y={A - 8} textAnchor="start" fontSize={12} fill="currentColor">{formatarData(asc[0].data)}</text>
        {asc.length > 1 && <text x={x(t1)} y={A - 8} textAnchor="end" fontSize={12} fill="currentColor">{formatarData(asc[asc.length - 1].data)}</text>}
        <polyline
          points={asc.map((p, i) => `${x(tempo[i])},${y(p.valor)}`).join(' ')}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-emerald-700 dark:stroke-emerald-400"
        />
        {asc.map((p, i) => (
          <g key={p.data + i}>
            <circle cx={x(tempo[i])} cy={y(p.valor)} r={4} strokeWidth={2} className="fill-emerald-700 stroke-white dark:fill-emerald-400 dark:stroke-zinc-900" />
            <circle cx={x(tempo[i])} cy={y(p.valor)} r={12} fill="transparent">
              <title>{`${formatarData(p.data)}: ${fmt(p.valor)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <details>
        <summary className="cursor-pointer text-sm">Ver os dados em tabela</summary>
        <table className="mt-2 text-left text-sm">
          <caption className="sr-only">{nome}</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {asc.map((p, i) => (
              <tr key={p.data + i}>
                <td>{formatarData(p.data)}</td>
                <td>{fmt(p.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
```

Run: `pnpm test src/modules/pacientes/evolucao.test.ts src/modules/pacientes/ui/grafico-linha.test.ts`
Expected: PASS.

- [ ] **Step 4: Aba Evolução** — `src/app/painel/pacientes/[id]/evolucao/page.tsx`

```tsx
import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '@/modules/pacientes/datas';
import { casasDoMarcador, evolucaoDoPaciente, MSG_POUCOS_DADOS } from '@/modules/pacientes/evolucao';
import { GraficoLinha } from '@/modules/pacientes/ui/grafico-linha';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

export default async function EvolucaoPage({ params }: PageProps<'/painel/pacientes/[id]/evolucao'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const e = await evolucaoDoPaciente(ctx, paciente.id);
  return (
    <div className="space-y-10">
      <section aria-labelledby="evolucao-medidas" className="space-y-4">
        <h2 id="evolucao-medidas" className="text-lg font-semibold">Medidas</h2>
        {e.avaliacoes < 2 ? (
          <p>{MSG_POUCOS_DADOS}</p>
        ) : (
          <>
            <table className="w-full max-w-2xl text-left text-sm">
              <caption className="text-left font-medium">Diferença entre o primeiro e o último registro</caption>
              <thead>
                <tr>
                  <th scope="col">Medida</th>
                  <th scope="col">Primeiro</th>
                  <th scope="col">Último</th>
                  <th scope="col">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {e.diferencas.map((d) => {
                  const casas = e.series.find((s) => s.rotulo === d.rotulo)?.casas ?? 1;
                  return (
                    <tr key={d.rotulo} className="border-t">
                      <th scope="row" className="font-normal">{d.rotulo}</th>
                      <td>{`${formatarDecimal(d.primeiro.valor, casas)} (${formatarData(d.primeiro.data)})`}</td>
                      <td>{`${formatarDecimal(d.ultimo.valor, casas)} (${formatarData(d.ultimo.data)})`}</td>
                      <td>{d.texto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="grid gap-6 lg:grid-cols-2">
              {e.series.filter((s) => s.pontos.length >= 2).map((s) => (
                <GraficoLinha key={s.id} id={`serie-${s.id}`} titulo={s.rotulo} unidade={s.unidade} casas={s.casas} pontos={s.pontos} />
              ))}
            </div>
          </>
        )}
      </section>
      <section aria-labelledby="evolucao-exames" className="space-y-4">
        <h2 id="evolucao-exames" className="text-lg font-semibold">Exames</h2>
        {e.marcadores.length === 0 ? (
          <p>Nenhum valor de exame lançado.</p>
        ) : (
          <>
            <nav aria-label="Marcadores de exame">
              <ul className="flex flex-wrap gap-3 text-sm">
                {e.marcadores.map((m, i) => <li key={`${m.nome}-${m.unidade ?? ''}`}><a href={`#marcador-${i}`} className="underline">{m.unidade ? `${m.nome} (${m.unidade})` : m.nome}</a></li>)}
              </ul>
            </nav>
            {e.marcadores.map((m, i) => (
              <div key={`${m.nome}-${m.unidade ?? ''}`} id={`marcador-${i}`} className="space-y-2">
                <h3 className="font-semibold">{m.unidade ? `${m.nome} (${m.unidade})` : m.nome}</h3>
                {m.pontos.length >= 2 ? (
                  <GraficoLinha id={`marcador-grafico-${i}`} titulo={m.nome} unidade={m.unidade ?? ''} casas={casasDoMarcador(m.pontos)} pontos={m.pontos} />
                ) : (
                  <p>{`${formatarData(m.pontos[0].data)}: ${String(m.pontos[0].valor).replace('.', ',')}${m.unidade ? ` ${m.unidade}` : ''}`}</p>
                )}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
```

Em `abas.tsx`, acrescentar antes de `historico`: `{ seg: 'evolucao', rotulo: 'Evolução' },`.

- [ ] **Step 5: Conferir o gráfico com os olhos** — com o `pnpm dev` no ar e um paciente com 2+ avaliações e um marcador com 2 valores, abrir `/painel/pacientes/<id>/evolucao` pelo MCP Playwright (`browser_navigate` + `browser_take_screenshot`), em claro e em escuro (`browser_emulate_media` com `colorScheme: 'dark'`): rótulos sem sobreposição, linha e pontos visíveis nos dois temas, datas nas pontas do eixo. Ajustar margens se algum rótulo cortar.

- [ ] **Step 6: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/modules/pacientes src/app/painel/pacientes
git commit -m "feat(pacientes): evolução com diferença primeiro × último, gráficos SVG acessíveis e marcadores de exame (P03-10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: LGPD — arquivar, atender pedido de exclusão (bloqueio) e anonimizar no fim do prazo (P03-11a)

**Files:**
- Create: `drizzle/0031_privacidade.sql` (gerada), `drizzle/0032_rls_privacidade.sql` (custom), `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/lgpd.test.ts`, `src/app/painel/pacientes/[id]/privacidade/page.tsx`, `src/app/painel/pacientes/[id]/privacidade/actions.ts`, `src/app/painel/pacientes/[id]/privacidade/exclusao-form.tsx`
- Modify: `src/db/schema/pacientes.ts`, `test/isolamento.test.ts`, `src/modules/pacientes/datas.ts`, `src/modules/pacientes/datas.test.ts`, `src/modules/plataforma/tenant-status.ts`, `src/modules/plataforma/audit.ts`, `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `src/app/painel/pacientes/[id]/abas.tsx`, `e2e/pacientes.spec.ts`

**Interfaces:**
- Consumes: `carregarPacienteParaEscrita`, `idValido`, `PacienteBloqueadoError` (Tarefa 1); `hojeNoFuso`, `formatarData` (Tarefa 1); `consultations` (Tarefa 10); `exams` (Tarefa 11); `invites` (Tarefa 3); `recordAudit`; `enqueueEmail`; `apagarArquivo`; `ConfirmarBotao`; `carregarProntuario`; `emailsNaFila`, `novoTenant`, `novoPaciente` (`test/pacientes.ts`).
- Produces:
  - Schema: `privacyRequests` 🔒 (`tipo` exportacao/exclusao, `status` aberto/concluido, `prazo`, `concluido_em`).
  - `@/modules/pacientes/datas`: `somarAnos(iso, anos): string`, `somarDias(iso, dias): string`.
  - `@/modules/plataforma/tenant-status`: `listarTenantsParaVarredura(db): Promise<{ id: string; fuso: string }[]>` (§4.1: varreduras do worker partem de `tenants`).
  - `EmailMessage` ganha `{ tipo: 'exclusao_atendida'; para; nome; nutri; anonimizarApos: string }` (data já formatada).
  - Fila `retencao-lgpd` (diária às 04h, America/Sao_Paulo).
  - `@/modules/pacientes/lgpd`: `PRAZO_GUARDA_ANOS = 20`, `PRAZO_RESPOSTA_DIAS = 15`, `MSG_LGPD`, `class LgpdError`, `arquivarPaciente(ctx, patientId, db?)`, `desarquivarPaciente(ctx, patientId, db?)`, `atenderPedidoExclusao(ctx, tenant, patientId, nomeDigitado, deps?): Promise<{ anonimizarApos: string }>`, `anexosDoPaciente(tx, patientId): Promise<string[]>`, `anonimizarVencidos(db, now, deps?): Promise<{ anonimizados: number }>`. A Tarefa 14 acrescenta as exportações em `anexosDoPaciente`; os Planos 05 e 06, push e fotos do diário em `atenderPedidoExclusao`.

- [ ] **Step 1: Datas, varredura de tenants e tabela** — em `src/modules/pacientes/datas.test.ts`, acrescentar (import `somarAnos`, `somarDias`):

```ts
describe('somarAnos / somarDias', () => {
  it('prazo de guarda e de resposta; 29/02 vira 28/02 em ano comum', () => {
    expect(somarAnos('2026-09-15', 20)).toBe('2046-09-15');
    expect(somarAnos('2024-02-29', 1)).toBe('2025-02-28');
    expect(somarDias('2026-10-01', 15)).toBe('2026-10-16');
    expect(somarDias('2026-12-25', 10)).toBe('2027-01-04');
  });
});
```

Em `src/modules/pacientes/datas.ts`, acrescentar:

```ts
/** 'AAAA-MM-DD' + anos (29/02 → 28/02 quando o ano de destino não é bissexto). */
export function somarAnos(iso: string, anos: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a + anos, m - 1, d));
  if (alvo.getUTCMonth() !== m - 1) alvo.setUTCDate(0);
  return alvo.toISOString().slice(0, 10);
}

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
```

Em `src/modules/plataforma/tenant-status.ts`, acrescentar:

```ts
/** §4.1: varreduras do worker entre tenants partem de `tenants` (inclusive suspensos: obrigação legal não para). */
export async function listarTenantsParaVarredura(db: Db): Promise<{ id: string; fuso: string }[]> {
  return db.select({ id: tenants.id, fuso: tenants.fuso }).from(tenants);
}
```

Acrescentar ao `src/db/schema/pacientes.ts`:

```ts
/** US-018 / RNF-08: pedidos do titular (exportação, exclusão). Prazo de resposta: 15 dias. */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    tipo: text('tipo').notNull(),
    status: text('status').notNull().default('aberto'),
    prazo: date('prazo', { mode: 'string' }).notNull(),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('privacy_requests_tipo_valido', sql`${t.tipo} in ('exportacao', 'exclusao')`),
    check('privacy_requests_status_valido', sql`${t.status} in ('aberto', 'concluido')`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'privacy_requests_paciente_fk' }),
    index('privacy_requests_paciente_idx').on(t.tenantId, t.patientId, t.status),
  ],
);
```

Run: `pnpm db:generate --name privacidade` → `drizzle/0031_privacidade.sql`.

Run: `pnpm drizzle-kit generate --custom --name rls_privacidade` e preencher `drizzle/0032_rls_privacidade.sql`:

```sql
SELECT app_enable_tenant_rls('privacy_requests');
--> statement-breakpoint
SELECT app_enable_patient_rls('privacy_requests');
--> statement-breakpoint
SELECT app_enable_audit('privacy_requests', 'pedidos_titular');
```

`test/isolamento.test.ts`, no `FABRICAS`:

```ts
  privacy_requests: (t, p) => sql`insert into privacy_requests (tenant_id, patient_id, tipo, prazo) values (${t}, ${p}, 'exclusao', '2026-01-16')`,
```

`src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `pedidos_titular: 'Pedido do titular (LGPD)',`.

Run: `pnpm test src/modules/pacientes/datas.test.ts src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 2: E-mail ao paciente** — acrescentar ao `src/email/render.test.ts`:

```ts
describe('exclusao_atendida (US-018)', () => {
  it('explica o que foi apagado e o que fica guardado por obrigação legal, com a data da anonimização', () => {
    const r = renderEmail({ tipo: 'exclusao_atendida', para: 'ana@ex.com', nome: 'Ana Souza', nutri: 'Debby Silva', anonimizarApos: '15/09/2046' });
    expect(r.subject).toBe('Seu pedido de exclusão de dados foi atendido');
    for (const t of ['Debby Silva atendeu o seu pedido de exclusão de dados', 'Foram apagados agora', 'LGPD, art. 16, I', 'até 15/09/2046']) expect(r.text).toContain(t);
  });
});
```

Em `src/email/types.ts`, acrescentar ao union: `| { tipo: 'exclusao_atendida'; para: string; nome: string; nutri: string; anonimizarApos: string }`.

Em `src/email/templates.tsx`, acrescentar o `case` antes do `default`:

```tsx
    case 'exclusao_atendida': {
      const subject = 'Seu pedido de exclusão de dados foi atendido';
      const linhas = [
        `Olá, ${msg.nome}!`,
        `${msg.nutri} atendeu o seu pedido de exclusão de dados no NutriDebby.`,
        'Foram apagados agora: as autorizações de mensagens por WhatsApp e os convites de acesso. Você não recebe mais lembretes nem mensagens deste acompanhamento.',
        `Por obrigação legal (LGPD, art. 16, I), o prontuário clínico fica guardado de forma bloqueada, só para consulta da nutricionista, até ${msg.anonimizarApos}. Depois dessa data, seus dados de identificação são anonimizados.`,
        'Se tiver dúvidas, fale com a sua nutricionista.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
          </Layout>,
        ),
        text: linhas.join('\n\n'),
      };
    }
```

Run: `pnpm test src/email/render.test.ts` → PASS.

- [ ] **Step 3: Testes que falham** — `src/modules/pacientes/lgpd.test.ts`

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, exams, invites, patients, privacyRequests, storedFiles, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import { registrarAtendimento } from './atendimentos';
import { PacienteBloqueadoError } from './base';
import { criarExame } from './exames';
import { anonimizarVencidos, arquivarPaciente, atenderPedidoExclusao, desarquivarPaciente, LgpdError, MSG_LGPD, PRAZO_GUARDA_ANOS } from './lgpd';
import { criarPaciente } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-lgpd-'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000', dataDir };
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const ler = async (ctx: Parameters<typeof withTenant>[0], id: string) => (await withTenant(ctx, (tx) => tx.select().from(patients).where(eq(patients.id, id)), app.db))[0];
const cadastro = (email: string) => ({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email, telefone: '(11) 91234-5678', whatsappAutorizado: true });

describe('arquivar (US-018 "Arquivar", RN-08)', () => {
  it('arquiva (o prontuário fica), apaga o convite pendente e desarquiva; bloqueado não desarquiva', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(`arq-${randomUUID().slice(0, 8)}@ex.com`), deps);
    await arquivarPaciente(T.ctx, p.id, app.db);
    expect((await ler(T.ctx, p.id)).status).toBe('arquivado');
    expect(await app.db.select().from(invites).where(and(eq(invites.patientId, p.id), isNull(invites.usadoEm)))).toEqual([]);
    await desarquivarPaciente(T.ctx, p.id, app.db);
    expect((await ler(T.ctx, p.id)).status).toBe('ativo');
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(desarquivarPaciente(T.ctx, bloqueado.id, app.db)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});

describe('atender pedido de exclusão durante a guarda (US-018, RNF-08)', () => {
  it('confirmar com outro nome não muda nada; com o nome (sem diferenciar maiúsculas/espaços) bloqueia, apaga opt-ins, conclui o pedido, audita e avisa o paciente', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const email = `exc-${randomUUID().slice(0, 8)}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(email), deps);
    await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-15', notasPrivadas: '', orientacoes: '' }, deps);
    await expect(atenderPedidoExclusao(T.ctx, T.tenant, p.id, 'Ana', deps)).rejects.toThrow(MSG_LGPD.confirmarNome);
    expect((await ler(T.ctx, p.id)).status).toBe('ativo');

    const r = await atenderPedidoExclusao(T.ctx, T.tenant, p.id, '  ana   SOUZA ', deps);
    expect(r).toEqual({ anonimizarApos: `${2026 + PRAZO_GUARDA_ANOS}-09-15` }); // última consulta + prazo legal (P-01)
    const b = await ler(T.ctx, p.id);
    expect(b).toMatchObject({ status: 'bloqueado', whatsappOptinEm: null, whatsappOptinOrigem: null, anonimizarApos: '2046-09-15', nome: 'Ana Souza' });
    expect(b.bloqueadoEm?.toISOString()).toBe(now.toISOString());
    expect(b.whatsappOptoutEm?.toISOString()).toBe(now.toISOString());
    const [pedido] = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(eq(privacyRequests.patientId, p.id)), app.db);
    expect(pedido).toMatchObject({ tipo: 'exclusao', status: 'concluido', prazo: '2026-10-16' });
    expect(await app.db.select().from(invites).where(and(eq(invites.patientId, p.id), isNull(invites.usadoEm)))).toEqual([]);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'bloquear'))), app.db);
    expect(log[0]).toMatchObject({ entidade: 'patients', actorUserId: T.nutriId });
    const [msg] = await emailsNaFila('exclusao_atendida', email);
    expect(msg).toMatchObject({ nome: 'Ana Souza', nutri: 'Debby Silva', anonimizarApos: '15/09/2046' });
    // prontuário mantido e só para consulta
    await expect(registrarAntropometria(T.ctx, T.tenant, p.id, entradaDoFormulario({ data: '2026-10-01', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }), deps)).rejects.toBeInstanceOf(
      PacienteBloqueadoError,
    );
  });

  it('pedido já aberto (registrado pelo portal no Plano 06) é concluído, sem criar outro; sem atendimento, conta da data do bloqueio', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.insert(privacyRequests).values({ tenantId: T.tenantId, patientId: p.id, tipo: 'exclusao', prazo: '2026-10-10' }), app.db);
    const r = await atenderPedidoExclusao(T.ctx, T.tenant, p.id, 'Ana Souza', deps);
    expect(r.anonimizarApos).toBe('2046-10-01');
    const pedidos = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(eq(privacyRequests.patientId, p.id)), app.db);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ status: 'concluido', prazo: '2026-10-10' });
    await expect(atenderPedidoExclusao(T.ctx, T.tenant, p.id, 'Ana Souza', deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});

describe('fim do prazo de guarda (job diário de retenção)', () => {
  it('anonimiza nome, e-mail, telefone e nascimento, solta a conta, apaga os anexos de /data e audita como Sistema; é idempotente', async () => {
    const T = await novoTenant(app.db);
    const uid = randomUUID();
    await app.db.insert(user).values({ id: uid, name: 'Ana', email: `conta-${uid.slice(0, 8)}@ex.com`, appRole: 'paciente' });
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511912345678', userId: uid });
    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]);
    await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: [], arquivo: PDF }, deps);
    const [exame] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.patientId, p.id)), app.db);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2026-09-30' }).where(eq(patients.id, p.id)), app.db);
    const futuro = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2046-09-30' });
    const noDia = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-10-01' }); // hoje em São Paulo

    const r = await anonimizarVencidos(app.db, now, { dataDir });
    expect(r.anonimizados).toBeGreaterThanOrEqual(1);
    const a = await ler(T.ctx, p.id);
    expect(a).toMatchObject({ nome: 'Paciente anonimizado', email: `anonimo-${p.id}@anonimizado.invalid`, telefoneE164: null, dataNascimento: null, userId: null, status: 'bloqueado' });
    expect(a.anonimizadoEm?.toISOString()).toBe(now.toISOString());
    expect(existsSync(path.join(dataDir, exame.arquivoPath!))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    expect((await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, exame.id)), app.db))[0].arquivoPath).toBeNull(); // o exame (valores) fica
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'anonimizar'))), app.db);
    expect(log).toHaveLength(1);
    expect(log[0].actorUserId).toBeNull();
    expect((await ler(T.ctx, futuro.id)).anonimizadoEm).toBeNull(); // prazo ainda não venceu
    expect((await ler(T.ctx, noDia.id)).anonimizadoEm).toBeNull(); // "guardado até 01/10": no próprio dia, ainda não

    await anonimizarVencidos(app.db, now, { dataDir });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'anonimizar'))), app.db)).toHaveLength(1);
  });

  it('nome digitado errado ou paciente de outro tenant: nada acontece', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(atenderPedidoExclusao(A.ctx, A.tenant, pB.id, 'Ana Souza', deps)).rejects.toThrow();
    expect((await ler(B.ctx, pB.id)).status).toBe('ativo');
    await expect(atenderPedidoExclusao(B.ctx, B.tenant, pB.id, '', deps)).rejects.toBeInstanceOf(LgpdError);
  });
});
```

Run: `pnpm test src/modules/pacientes/lgpd.test.ts`
Expected: FAIL — `Cannot find module './lgpd'`.

- [ ] **Step 4: Implementar** — `src/modules/pacientes/lgpd.ts`

```ts
import { and, eq, isNotNull, isNull, lt, max, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { consultations, exams, invites, patients, privacyRequests } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { logger } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { carregarPacienteParaEscrita } from './base';
import { formatarData, hojeNoFuso, somarAnos, somarDias } from './datas';

/** P-01: referência da spec (20 anos, Lei 13.787/2018). Validar com CRN/advogado antes do go-live. */
export const PRAZO_GUARDA_ANOS = 20;
/** RNF-08 / §7 privacy_requests: prazo de resposta ao titular. */
export const PRAZO_RESPOSTA_DIAS = 15;

export const MSG_LGPD = {
  confirmarNome: 'Digite o nome do paciente exatamente como está no cadastro para confirmar.',
} as const;

export class LgpdError extends Error {
  override name = 'LgpdError';
}

async function apagarConvitesPendentes(tx: Tx, tenantId: string, patientId: string) {
  await tx.delete(invites).where(and(eq(invites.tenantId, tenantId), eq(invites.patientId, patientId), isNull(invites.usadoEm)));
}

/** RN-08: o prontuário fica; portal, notificações e audiências leem o status (Planos 05, 06 e 07). */
export async function arquivarPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.status !== 'ativo') return;
      await tx.update(patients).set({ status: 'arquivado', updatedAt: new Date() }).where(eq(patients.id, p.id));
      await apagarConvitesPendentes(tx, ctx.tenantId, p.id);
    },
    db,
  );
}

export async function desarquivarPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado → PacienteBloqueadoError
      if (p.status === 'arquivado') await tx.update(patients).set({ status: 'ativo', updatedAt: new Date() }).where(eq(patients.id, p.id));
    },
    db,
  );
}

const nomeParaConferir = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * US-018 "Pedido de exclusão durante o prazo de guarda": o prontuário clínico fica identificado e só
 * para consulta (status `bloqueado`); saem na hora os dados não obrigatórios (opt-ins, convites).
 * `anonimizar_apos` = última consulta (ou hoje) + PRAZO_GUARDA_ANOS. Tudo numa transação, com o
 * e-mail ao paciente na fila. Planos 05 e 06: apagar aqui também inscrições de push e fotos do diário.
 */
export async function atenderPedidoExclusao(
  ctx: TenantContext,
  tenant: { fuso: string; nomeExibicao: string },
  patientId: string,
  nomeDigitado: string,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ anonimizarApos: string }> {
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (!nomeDigitado.trim() || nomeParaConferir(nomeDigitado) !== nomeParaConferir(p.nome)) throw new LgpdError(MSG_LGPD.confirmarNome);
      const hoje = hojeNoFuso(tenant.fuso, now);
      const [{ ultima }] = await tx.select({ ultima: max(consultations.data) }).from(consultations).where(eq(consultations.patientId, p.id));
      const anonimizarApos = somarAnos(ultima ?? hoje, PRAZO_GUARDA_ANOS);

      const [aberto] = await tx
        .select({ id: privacyRequests.id })
        .from(privacyRequests)
        .where(and(eq(privacyRequests.patientId, p.id), eq(privacyRequests.tipo, 'exclusao'), eq(privacyRequests.status, 'aberto')))
        .for('update');
      if (aberto) await tx.update(privacyRequests).set({ status: 'concluido', concluidoEm: now }).where(eq(privacyRequests.id, aberto.id));
      else {
        await tx.insert(privacyRequests).values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          tipo: 'exclusao',
          status: 'concluido',
          prazo: somarDias(hoje, PRAZO_RESPOSTA_DIAS),
          concluidoEm: now,
          createdAt: now,
        });
      }
      await tx
        .update(patients)
        .set({ status: 'bloqueado', bloqueadoEm: now, anonimizarApos, whatsappOptinEm: null, whatsappOptinOrigem: null, whatsappOptoutEm: now, updatedAt: now })
        .where(eq(patients.id, p.id));
      await apagarConvitesPendentes(tx, ctx.tenantId, p.id);
      await recordAudit(tx, { acao: 'bloquear', entidade: 'patients', entidadeId: p.id, patientId: p.id });
      await enqueueEmail(
        { tipo: 'exclusao_atendida', para: p.email, nome: p.nome, nutri: tenant.nomeExibicao, anonimizarApos: formatarData(anonimizarApos) },
        { tenantId: ctx.tenantId, tx },
      );
      return { anonimizarApos };
    },
    deps.db ?? getDb(),
  );
}

/** Arquivos em /data ligados ao paciente (a Tarefa 14 acrescenta as exportações). */
export async function anexosDoPaciente(tx: Tx, patientId: string): Promise<string[]> {
  const deExames = await tx.select({ c: exams.arquivoPath }).from(exams).where(and(eq(exams.patientId, patientId), isNotNull(exams.arquivoPath)));
  return deExames.map((e) => e.c!);
}

/**
 * US-018 "Fim do prazo de guarda": job diário (fila retencao-lgpd). Para cada tenant (§4.1: a varredura
 * parte de `tenants`), anonimiza quem está bloqueado com `anonimizar_apos` já passado no fuso do tenant
 * ("guardado até 15/09/2046; depois dessa data…": no próprio dia 15 ainda não).
 * Primeiro os anexos, com o `rm` confirmado antes do commit (se o arquivo não sair do disco, o registro
 * fica e o dia seguinte tenta de novo), depois a identificação. Um tenant com erro não para os outros.
 */
export async function anonimizarVencidos(db: Db, now: Date, deps: { dataDir?: string } = {}): Promise<{ anonimizados: number }> {
  let anonimizados = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    const hoje = hojeNoFuso(t.fuso, now);
    let vencidos: { id: string }[];
    try {
      vencidos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: patients.id })
            .from(patients)
            .where(and(eq(patients.status, 'bloqueado'), isNull(patients.anonimizadoEm), lt(patients.anonimizarApos, hoje))),
        db,
      );
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), tenantId: t.id }, 'falha ao listar pacientes a anonimizar');
      continue;
    }
    for (const { id } of vencidos) {
      try {
        for (const caminho of await withTenant(ctx, (tx) => anexosDoPaciente(tx, id), db)) {
          await apagarArquivo(ctx, { caminho }, { db, dataDir: deps.dataDir, removerAntesDoCommit: true });
        }
        const feito = await withTenant(
          ctx,
          async (tx) => {
            const r = await tx
              .update(patients)
              .set({
                nome: 'Paciente anonimizado',
                email: sql`'anonimo-' || ${patients.id}::text || '@anonimizado.invalid'`,
                telefoneE164: null,
                dataNascimento: null,
                userId: null,
                anonimizadoEm: now,
                updatedAt: now,
              })
              .where(and(eq(patients.id, id), isNull(patients.anonimizadoEm)))
              .returning({ id: patients.id });
            if (r.length) await recordAudit(tx, { acao: 'anonimizar', entidade: 'patients', entidadeId: id, patientId: id });
            return r.length > 0;
          },
          db,
        );
        if (feito) anonimizados++;
      } catch (err) {
        // Sem nome nem dado do paciente no log (RNF-11); o próximo dia tenta de novo
        logger.error({ err: err instanceof Error ? err.message : String(err), tenantId: t.id }, 'falha ao anonimizar paciente');
      }
    }
  }
  return { anonimizados };
}
```

Run: `pnpm test src/modules/pacientes/lgpd.test.ts`
Expected: PASS.

- [ ] **Step 5: Job no worker** — em `src/jobs/queues.ts`, acrescentar ao `QUEUES`:

```ts
  // US-018: anonimização no fim do prazo de guarda (04h, depois do backup das 03h)
  'retencao-lgpd': { retryLimit: 2, retryDelay: 600, expireInSeconds: 900 },
```

Em `src/worker/index.ts` (import `anonimizarVencidos` de `@/modules/pacientes/lgpd`), depois do bloco do `monitor-disco`:

```ts
  // US-018: fim do prazo de guarda — anonimiza os bloqueados vencidos e apaga os anexos
  await boss.schedule('retencao-lgpd', '0 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('retencao-lgpd', async () => {
    const r = await anonimizarVencidos(getDb(), new Date(), { dataDir: env.DATA_DIR });
    logger.info({ anonimizados: r.anonimizados }, 'retenção LGPD concluída');
  });
```

Run: `pnpm test src/worker src/jobs`
Expected: PASS (o `boss.test.ts` confere que `ensureQueues` cria as filas de `QUEUES`).

- [ ] **Step 6: Aba Privacidade** — `src/app/painel/pacientes/[id]/privacidade/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { arquivarPaciente, atenderPedidoExclusao, desarquivarPaciente, LgpdError } from '@/modules/pacientes/lgpd';

const caminho = (id: string) => `/painel/pacientes/${id}/privacidade`;

async function situacao(patientId: string, fn: (ctx: Awaited<ReturnType<typeof requireNutri>>['ctx']) => Promise<void>) {
  const { ctx } = await requireNutri(caminho(patientId));
  try {
    await fn(ctx);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}

export async function arquivarAction(patientId: string): Promise<void> {
  await situacao(patientId, (ctx) => arquivarPaciente(ctx, patientId));
}

export async function desarquivarAction(patientId: string): Promise<void> {
  await situacao(patientId, (ctx) => desarquivarPaciente(ctx, patientId));
}

export type ExclusaoState = { erro?: string };

export async function atenderExclusaoAction(patientId: string, _prev: ExclusaoState, formData: FormData): Promise<ExclusaoState> {
  const { ctx, tenant } = await requireNutri(caminho(patientId));
  try {
    await atenderPedidoExclusao(ctx, tenant, patientId, String(formData.get('confirmacao') ?? ''));
  } catch (e) {
    if (e instanceof LgpdError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return {};
}
```

`src/app/painel/pacientes/[id]/privacidade/exclusao-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import type { ExclusaoState } from './actions';

export function ExclusaoForm({ acao }: { acao: (prev: ExclusaoState, formData: FormData) => Promise<ExclusaoState> }) {
  const [state, action, pendente] = useActionState<ExclusaoState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="confirmacao" className="block font-medium">Digite o nome do paciente para confirmar</label>
      <input id="confirmacao" name="confirmacao" autoComplete="off" className="w-full max-w-md rounded border p-2"
        aria-invalid={state.erro ? true : undefined} aria-describedby={state.erro ? 'confirmacao-erro' : undefined} />
      {state.erro && <p id="confirmacao-erro" role="alert" className="text-red-700">{state.erro}</p>}
      <button disabled={pendente} className="rounded bg-red-700 px-4 py-2 text-white">Atender pedido de exclusão</button>
    </form>
  );
}
```

`src/app/painel/pacientes/[id]/privacidade/page.tsx`

```tsx
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { formatarData } from '@/modules/pacientes/datas';
import { PRAZO_GUARDA_ANOS } from '@/modules/pacientes/lgpd';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../prontuario';
import { arquivarAction, atenderExclusaoAction, desarquivarAction } from './actions';
import { ExclusaoForm } from './exclusao-form';

export const dynamic = 'force-dynamic';

export default async function PrivacidadePage({ params }: PageProps<'/painel/pacientes/[id]/privacidade'>) {
  const { id } = await params;
  const { tenant, paciente } = await carregarProntuario(id);
  return (
    <div className="max-w-3xl space-y-8">
      <section aria-labelledby="arquivamento" className="space-y-2">
        <h2 id="arquivamento" className="text-lg font-semibold">Arquivamento</h2>
        {paciente.status === 'ativo' && (
          <>
            <p>O paciente arquivado perde o acesso ao portal e deixa de receber notificações. O prontuário é mantido e continua acessível para você.</p>
            <form action={arquivarAction.bind(null, paciente.id)}>
              <ConfirmarBotao mensagem="Arquivar este paciente?">Arquivar paciente</ConfirmarBotao>
            </form>
          </>
        )}
        {paciente.status === 'arquivado' && (
          <form action={desarquivarAction.bind(null, paciente.id)}>
            <button className="rounded border px-4 py-2">Desarquivar paciente</button>
          </form>
        )}
        {paciente.status === 'bloqueado' && <p>Paciente bloqueado por pedido de exclusão: não pode ser desarquivado.</p>}
      </section>

      <section aria-labelledby="exclusao" className="space-y-2">
        <h2 id="exclusao" className="text-lg font-semibold">Pedido de exclusão (LGPD, art. 18)</h2>
        {paciente.status === 'bloqueado' ? (
          <p role="status">
            {`Pedido atendido em ${paciente.bloqueadoEm ? formatarDataHora(paciente.bloqueadoEm, tenant.fuso) : '—'}. `}
            {paciente.anonimizadoEm ? 'Os dados de identificação já foram anonimizados.' : `Anonimização prevista para ${paciente.anonimizarApos ? formatarData(paciente.anonimizarApos) : '—'}.`}
          </p>
        ) : (
          <>
            <p>
              {`Durante o prazo de guarda do prontuário (${PRAZO_GUARDA_ANOS} anos após a última consulta), os dados clínicos ficam guardados, identificados e só para sua consulta. Na hora são apagados as autorizações de WhatsApp e os convites, e o paciente recebe um e-mail explicando. No fim do prazo, os dados de identificação são anonimizados.`}
            </p>
            <ExclusaoForm acao={atenderExclusaoAction.bind(null, paciente.id)} />
          </>
        )}
      </section>
    </div>
  );
}
```

Em `abas.tsx`, acrescentar antes de `historico`: `{ seg: 'privacidade', rotulo: 'Privacidade' },`.

- [ ] **Step 7: E2E do arquivamento** — acrescentar ao `e2e/pacientes.spec.ts` (por último, porque tira a Ana dos ativos até desarquivar):

```ts
test('arquivar tira da lista de ativos e mostra o selo; desarquivar devolve (US-018 "Arquivar")', async () => {
  await nutri.goto(`${prontuario}/privacidade`);
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.locator('header', { hasText: ANA.nome }).getByText('Arquivado', { exact: true })).toBeVisible(); // selo do prontuário
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(ANA.email)}`);
  await expect(nutri.getByText('Nenhum paciente encontrado.')).toBeVisible();
  await nutri.goto(`/painel/pacientes?status=arquivado&busca=${encodeURIComponent(ANA.email)}`);
  await expect(nutri.getByRole('link', { name: ANA.nome })).toBeVisible();
  await nutri.goto(`${prontuario}/privacidade`);
  await nutri.getByRole('button', { name: 'Desarquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Arquivar paciente' })).toBeVisible();
});
```

- [ ] **Step 8: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e e2e/pacientes.spec.ts`
Expected: tudo verde.

```bash
git add src/db/schema/pacientes.ts drizzle/0031_privacidade.sql drizzle/0032_rls_privacidade.sql drizzle/meta test/isolamento.test.ts \
  src/modules/pacientes src/modules/plataforma src/email src/jobs/queues.ts src/worker/index.ts src/app/painel/pacientes e2e/pacientes.spec.ts
git commit -m "feat(pacientes): LGPD — arquivar, atender exclusão com bloqueio e e-mail ao titular, anonimização diária no fim da guarda (P03-11a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: Exportar os dados do paciente — ZIP (`dados.json` + `prontuario.pdf`) pelo worker, link de 24 h por e-mail (P03-11b)

**Files:**
- Create: `drizzle/0033_exportacoes.sql` (gerada), `drizzle/0034_rls_exportacoes.sql` (custom), `src/modules/pacientes/exportacao.ts`, `src/modules/pacientes/exportacao-job.ts`, `src/modules/pacientes/prontuario-pdf.tsx`, `src/modules/pacientes/exportacao.test.ts`, `src/app/painel/pacientes/[id]/exportacoes/[exportId]/page.tsx`
- Modify: `package.json` + `pnpm-lock.yaml` (`@react-pdf/renderer`, `fflate`), `src/lib/file-type.ts`, `src/lib/file-type.test.ts`, `src/lib/signed-url.ts`, `src/app/api/arquivos/route.ts`, `src/app/api/arquivos/route.test.ts`, `src/db/schema/pacientes.ts`, `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts`, `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `src/modules/pacientes/lgpd.ts` (`anexosDoPaciente`), `src/app/painel/pacientes/[id]/privacidade/page.tsx`, `src/app/painel/pacientes/[id]/privacidade/actions.ts`, `CLAUDE.md` (regra 1), `scripts/backup/nutri-backup.sh` e `test/backup.test.ts` (ZIPs de exportação fora do backup)

**Interfaces:**
- Consumes: `salvarArquivo`, `apagarArquivo`, `CotaEsgotadaError` (Plano 02); `signFileUrl`; `recordAudit`; `enqueueEmail`; `getBoss` (`@/jobs/boss`); `fromDrizzle` (`pg-boss`); `tenantIsActive`, `buscarTenant` (`@/modules/plataforma/tenant-status`); `respostaParaCampo`, `type Pergunta` (Tarefa 9); `kcal`, `FORMULAS_TMB` (Tarefa 6); `patients`, `anamneses`, `anthropometry`, `energyCalcs`, `exams`, `consultations`, `privacyRequests` (schema); `idValido`, `PacienteNaoEncontradoError` (Tarefa 1); `anexosDoPaciente` (Tarefa 13).
- Produces:
  - `TipoArquivo` ganha `{ mime: 'application/zip'; ext: 'zip' }`; `CAMINHO_ARQUIVO` aceita `.zip`; `/api/arquivos` serve `.zip` como anexo.
  - Schema: `dataExports` 🔒 (`status` pendente/pronta/falhou/expirada, `arquivo_path` → `stored_files.caminho` SET NULL, `expira_em`, `solicitado_por`).
  - Filas `exportacao-paciente` e `expirar-exportacao` (payload `{ tenantId, exportId }`, sem dado pessoal).
  - `EmailMessage` ganha `{ tipo: 'exportacao_pronta'; para; link }` (sem nada do paciente).
  - `@/modules/pacientes/exportacao` (app): `EXPORTACAO_VALIDADE_MS`, `type EstadoExportacao`, `solicitarExportacao(ctx, patientId, deps?): Promise<string>`, `estadoDaExportacao(ctx, patientId, exportId, db?, now?)`, `exportacoesRecentes(ctx, patientId, db?)`, `linkDaExportacao(appUrl, patientId, exportId)`.
  - `@/modules/pacientes/exportacao-job` (só worker): `type DadosExportacao`, `montarDados(tx, patientId, now, fuso): Promise<DadosExportacao>`, `gerarExportacao(data, deps): Promise<'pronta' | 'ignorada' | 'falhou'>`, `expirarExportacao(data, deps): Promise<void>`, `expirarExportacoesVencidas(db, now, deps?): Promise<{ expiradas: number }>`, `paraWinAnsi(t): string` (em `prontuario-pdf.tsx`).
  - `@/modules/pacientes/prontuario-pdf`: `renderizarProntuario(dados, nutri): Promise<Buffer>`. O P04-09 reaproveita o `@react-pdf/renderer`.

- [ ] **Step 1: Dependências e orçamento da imagem** — `pnpm add --save-exact @react-pdf/renderer fflate` (a versão mais nova que o *minimum-release-age* aceitar; em 2026-09-29 eram `@react-pdf/renderer@4.9.0` e `fflate@0.8.3`). Registrar as versões no commit. Conferir o peso: `du -sh node_modules/.pnpm/@react-pdf* node_modules/.pnpm/fontkit* node_modules/.pnpm/fflate*` — esperado na casa de 20–30 MB descomprimidos. O orçamento de verdade é o job `image` do CI (≤ 260 MB comprimida; hoje 230 MB): conferir no primeiro push da tarefa. **Se passar de 260 MB, parar e avisar o dono** (não subir o limite, não trocar a biblioteca sem combinar).

- [ ] **Step 2: ZIP como tipo de arquivo** — acrescentar ao `src/lib/file-type.test.ts`:

```ts
it('reconhece ZIP (exportação de dados) pelo cabeçalho local "PK\\x03\\x04"', () => {
  expect(detectarTipo(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toEqual({ mime: 'application/zip', ext: 'zip' });
  expect(detectarTipo(Buffer.from('PK'))).toBeNull();
});
```

Em `src/lib/file-type.ts`: acrescentar `| { mime: 'application/zip'; ext: 'zip' }` ao `TipoArquivo` e, em `detectarTipo`, antes do teste de SVG: `if (bytesEm(buf, [0x50, 0x4b, 0x03, 0x04])) return { mime: 'application/zip', ext: 'zip' };`. (Só a exportação passa `'zip'` em `permitidos`; os uploads continuam recusando.)

Em `src/lib/signed-url.ts`, na regex `CAMINHO_ARQUIVO`, trocar `(png|jpg|webp|heic|pdf)` por `(png|jpg|webp|heic|pdf|zip)`.

Em `src/app/api/arquivos/route.ts`: acrescentar `zip: 'application/zip',` ao `MIME` e trocar a linha do `content-disposition` (a da Tarefa 11) por `'content-disposition': ext === 'zip' ? 'attachment; filename="exportacao.zip"' : ext === 'pdf' ? 'attachment; filename="documento.pdf"' : 'inline',`.

Acrescentar ao `src/app/api/arquivos/route.test.ts` um caso no mesmo estilo dos existentes: gravar `Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])` em `<DATA_DIR>/<tenant>/exportacao/<uuid>.zip`, pedir a URL de `signFileUrl` e conferir `content-type: application/zip` e `content-disposition: attachment; filename="exportacao.zip"`.

Run: `pnpm test src/lib/file-type.test.ts src/lib/signed-url.test.ts src/app/api/arquivos/route.test.ts` → PASS.

- [ ] **Step 3: Tabela, filas e e-mail** — acrescentar ao `src/db/schema/pacientes.ts`:

```ts
/** US-018 "Exportar": estado do job e do link de 24 h. O ZIP é um stored_files (cota; some ao expirar). */
export const dataExports = pgTable(
  'data_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    status: text('status').notNull().default('pendente'),
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    expiraEm: timestamp('expira_em', { withTimezone: true }),
    solicitadoPor: uuid('solicitado_por').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('data_exports_status_valido', sql`${t.status} in ('pendente', 'pronta', 'falhou', 'expirada')`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'data_exports_paciente_fk' }),
    index('data_exports_paciente_idx').on(t.tenantId, t.patientId, t.createdAt),
  ],
);
```

Run: `pnpm db:generate --name exportacoes` → `drizzle/0033_exportacoes.sql`.

Run: `pnpm drizzle-kit generate --custom --name rls_exportacoes` e preencher `drizzle/0034_rls_exportacoes.sql`:

```sql
SELECT app_enable_tenant_rls('data_exports');
--> statement-breakpoint
SELECT app_enable_patient_rls('data_exports');
--> statement-breakpoint
SELECT app_enable_audit('data_exports', 'exportacoes');
```

`test/isolamento.test.ts`, no `FABRICAS`: `data_exports: (t, p) => sql\`insert into data_exports (tenant_id, patient_id) values (${t}, ${p})\`,`.

`src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `exportacoes: 'Exportação de dados',`.

`src/jobs/queues.ts`, no `QUEUES`:

```ts
  // US-018: ZIP da exportação (PDF no worker) e remoção do arquivo 24 h depois
  'exportacao-paciente': { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  'expirar-exportacao': { retryLimit: 3, retryDelay: 300, expireInSeconds: 120 },
```

E-mail — teste no `src/email/render.test.ts`:

```ts
it('exportacao_pronta: link de 24 h, sem nenhum dado do paciente', () => {
  const r = renderEmail({ tipo: 'exportacao_pronta', para: 'debby@ex.com', link: 'http://localhost:3000/painel/pacientes/p/exportacoes/e' });
  expect(r.subject).toBe('Exportação de dados pronta');
  expect(r.text).toContain('24 horas');
  expect(r.html).toContain('href="http://localhost:3000/painel/pacientes/p/exportacoes/e"');
});
```

`src/email/types.ts`: `| { tipo: 'exportacao_pronta'; para: string; link: string }`. `src/email/templates.tsx`, `case` antes do `default`:

```tsx
    case 'exportacao_pronta': {
      const subject = 'Exportação de dados pronta';
      const linhas = ['A exportação de dados que você pediu no NutriDebby está pronta.', 'O link vale por 24 horas e pede que você entre no painel.'];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.link}>Baixar exportação</Botao>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link].join('\n\n'),
      };
    }
```

Run: `pnpm test src/email src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 4: Testes que falham da exportação** — `src/modules/pacientes/exportacao.test.ts`

```ts
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, dataExports, storedFiles, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { buscarModelo, preencherAnamnese, salvarModelo } from './anamnese';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import { registrarAtendimento } from './atendimentos';
import { salvarEtiquetasDoPaciente } from './etiquetas';
import { criarExame } from './exames';
import { estadoDaExportacao, solicitarExportacao } from './exportacao';
import { expirarExportacao, expirarExportacoesVencidas, gerarExportacao } from './exportacao-job';
import { paraWinAnsi } from './prontuario-pdf';
import { anexosDoPaciente } from './lgpd';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-export-'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, dataDir, appUrl: 'http://localhost:3000' };
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const NOTA = 'suspeita de compulsão';

async function prontuarioCompleto() {
  const T = await novoTenant(app.db, 'Debby Silva');
  const p = await novoPaciente(app.db, T.ctx);
  const modelo = await salvarModelo(T.ctx, null, { nome: 'Consulta', perguntas: [{ tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: false }] }, app.db);
  const [pergunta] = (await buscarModelo(T.ctx, modelo, app.db))!.schema.perguntas;
  await preencherAnamnese(T.ctx, T.tenant, p.id, modelo, { [pergunta.id]: 'Lactose' }, deps);
  await registrarAntropometria(T.ctx, T.tenant, p.id, entradaDoFormulario({ data: '2026-09-01', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }), deps);
  await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: 'Glicemia de jejum', valor: '95', unidade: 'mg/dL' }], arquivo: null }, deps);
  await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-01', notasPrivadas: NOTA, orientacoes: 'beber 2 L de água/dia' }, deps);
  await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'etiqueta-secreta' }, app.db);
  return { T, p };
}

describe('exportar dados do paciente (US-018 "Exportar")', () => {
  it('pedir registra "exportar" no audit_log e põe o job na fila; pedir de novo enquanto gera não duplica', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    expect(await solicitarExportacao(T.ctx, p.id, deps)).toBe(id);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'exportar')), app.db);
    expect(log.filter((l) => l.patientId === p.id)).toHaveLength(1);
    expect(log.find((l) => l.patientId === p.id)).toMatchObject({ entidade: 'patients', actorUserId: T.nutriId });
    const jobs = await (await getBoss()).findJobs<{ tenantId: string; exportId: string }>('exportacao-paciente');
    expect(jobs.filter((j) => j.data.exportId === id)).toHaveLength(1);
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'pendente' });
  });

  it('o job gera o ZIP com dados.json e prontuario.pdf — sem notas privadas nem etiquetas — e manda o link de 24 h por e-mail', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    expect(await gerarExportacao({ tenantId: T.tenantId, exportId: id }, { ...deps, ultimaTentativa: false })).toBe('pronta');
    const estado = await estadoDaExportacao(T.ctx, p.id, id, app.db, now);
    if (estado.estado !== 'pronta') throw new Error(estado.estado);
    expect(estado.expiraEm.toISOString()).toBe('2026-10-02T15:00:00.000Z');
    expect(estado.caminho).toMatch(new RegExp(`^${T.tenantId}/exportacao/[0-9a-f-]{36}\\.zip$`));
    const zip = unzipSync(readFileSync(path.join(dataDir, estado.caminho)));
    expect(Object.keys(zip).sort()).toEqual(['dados.json', 'prontuario.pdf']);
    expect(strFromU8(zip['prontuario.pdf'].subarray(0, 5))).toBe('%PDF-');
    const json = strFromU8(zip['dados.json']);
    const dados = JSON.parse(json);
    expect(dados.paciente).toMatchObject({ nome: 'Ana Souza', dataNascimento: '1991-03-10' });
    expect(dados.anamneses[0].respostas).toEqual([{ pergunta: 'Alergias', resposta: 'Lactose' }]);
    expect(dados.atendimentos).toEqual([{ data: '2026-09-01', orientacoes: 'beber 2 L de água/dia' }]);
    expect(dados.exames[0].valores[0]).toMatchObject({ nome: 'Glicemia de jejum', valor: 95 });
    expect(json).not.toContain(NOTA); // US-016
    expect(json).not.toContain('etiqueta-secreta'); // US-019
    const [nutri] = await app.db.select().from(user).where(eq(user.id, T.nutriId));
    const [msg] = await emailsNaFila('exportacao_pronta', nutri.email);
    expect(msg.link).toBe(`http://localhost:3000/painel/pacientes/${p.id}/exportacoes/${id}`);
    const expirar = (await (await getBoss()).findJobs<{ exportId: string }>('expirar-exportacao')).filter((j) => j.data.exportId === id);
    expect(expirar).toHaveLength(1);
    expect(await withTenant(T.ctx, (tx) => anexosDoPaciente(tx, p.id), app.db)).toContain(estado.caminho); // a anonimização apaga
    // rodar de novo (retry do pg-boss) não gera outro ZIP
    expect(await gerarExportacao({ tenantId: T.tenantId, exportId: id }, { ...deps, ultimaTentativa: false })).toBe('ignorada');
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')), app.db)).toHaveLength(1);
  });

  it('24 h depois o arquivo some e o link diz que expirou; a cota volta', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    await gerarExportacao({ tenantId: T.tenantId, exportId: id }, { ...deps, ultimaTentativa: false });
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, new Date('2026-10-02T15:00:01Z'))).toEqual({ estado: 'expirada' });
    await expirarExportacao({ tenantId: T.tenantId, exportId: id }, { db: app.db, dataDir });
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, id)), app.db);
    expect(e).toMatchObject({ status: 'expirada', arquivoPath: null });
    expect(readdirSync(path.join(dataDir, T.tenantId, 'exportacao'))).toEqual([]);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0].armazenamentoBytes).toBe(0);
  });

  it('tenant suspenso: o job não gera nada (RN-15) e o pedido vira "falhou"; reativado, pedir de novo cria outro job', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    expect(await gerarExportacao({ tenantId: T.tenantId, exportId: id }, { ...deps, ultimaTentativa: false })).toBe('ignorada');
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'falhou' });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')), app.db)).toEqual([]);
    await app.db.update(tenants).set({ status: 'ativa' }).where(eq(tenants.id, T.tenantId));
    const novo = await solicitarExportacao(T.ctx, p.id, deps);
    expect(novo).not.toBe(id);
    const jobs = await (await getBoss()).findJobs<{ exportId: string }>('exportacao-paciente');
    expect(jobs.filter((j) => j.data.exportId === novo)).toHaveLength(1);
  });

  it('falha na última tentativa marca "falhou" e não deixa ZIP nem cota', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    const quebrado = { ...deps, ultimaTentativa: true, renderizar: async () => Promise.reject(new Error('pdf quebrou')) };
    expect(await gerarExportacao({ tenantId: T.tenantId, exportId: id }, quebrado)).toBe('falhou');
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'falhou' });
    expect((await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId)))[0].armazenamentoBytes).toBe(0);
  });

  it('pendente há mais de 30 min (job perdido) não prende o paciente: pedir de novo cria outro', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    const depois = { ...deps, now: new Date(now.getTime() + 31 * 60_000) };
    const novo = await solicitarExportacao(T.ctx, p.id, depois);
    expect(novo).not.toBe(id);
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, depois.now)).toEqual({ estado: 'falhou' });
  });

  it('varredura diária: pronta vencida perde o ZIP mesmo sem o job de expiração; pendente de ontem vira "falhou"', async () => {
    const { T, p } = await prontuarioCompleto();
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    await gerarExportacao({ tenantId: T.tenantId, exportId: id }, { ...deps, ultimaTentativa: false });
    const esquecido = await solicitarExportacao(T.ctx, (await novoPaciente(app.db, T.ctx)).id, deps);
    const r = await expirarExportacoesVencidas(app.db, new Date('2026-10-02T15:00:01Z'), { dataDir });
    expect(r.expiradas).toBeGreaterThanOrEqual(1);
    expect(await estadoDaExportacao(T.ctx, p.id, id, app.db, now)).toEqual({ estado: 'expirada' });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.tipo, 'exportacao')), app.db)).toEqual([]);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, esquecido)), app.db);
    expect(e.status).toBe('falhou');
  });

  it('PDF: caracteres fora do WinAnsi da Helvetica viram equivalentes, nunca outro caractere em silêncio', () => {
    expect(paraWinAnsi('≥ 40 mg/dL · ≤ 99 · −3,2 kg')).toBe('>= 40 mg/dL · <= 99 · -3,2 kg');
    expect(paraWinAnsi('ação – “ok” 😀')).toBe('ação – “ok” ?');
  });

  it('o PDF e o ZIP ficam fora do grafo do Next: nenhuma rota importa exportacao-job ou @react-pdf', () => {
    const arquivos = readdirSync(path.resolve('src/app'), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.tsx?$/.test(d.name));
    for (const d of arquivos) expect(readFileSync(path.join(d.parentPath, d.name), 'utf8'), d.name).not.toMatch(/exportacao-job|@react-pdf|prontuario-pdf/);
  });
});
```

Run: `pnpm test src/modules/pacientes/exportacao.test.ts`
Expected: FAIL — `Cannot find module './exportacao'`.

- [ ] **Step 5: Pedido e estado (app)** — `src/modules/pacientes/exportacao.ts`

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { dataExports, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { recordAudit } from '@/modules/plataforma/audit';
import { idValido, PacienteNaoEncontradoError } from './base';

export const EXPORTACAO_VALIDADE_MS = 24 * 60 * 60 * 1000; // US-018: link válido por 24 h
/** Pendente há mais que isto = o job se perdeu (3 tentativas de até 5 min + espera): um pedido novo é criado. */
export const PENDENTE_MAX_MS = 30 * 60 * 1000;

export type EstadoExportacao =
  | { estado: 'pendente' }
  | { estado: 'pronta'; caminho: string; expiraEm: Date }
  | { estado: 'expirada' }
  | { estado: 'falhou' }
  | { estado: 'inexistente' };

export function linkDaExportacao(appUrl: string, patientId: string, exportId: string): string {
  return `${appUrl.replace(/\/$/, '')}/painel/pacientes/${patientId}/exportacoes/${exportId}`;
}

/**
 * "Exportar dados": grava o pedido, o `exportar` no audit_log e o job na mesma transação. Um pedido
 * ainda sendo gerado é reaproveitado (duplo clique não gera dois ZIPs); pendente há mais de 30 min é
 * dado como perdido (job expirado, worker que caiu): vira "falhou" e nasce outro. Vale também para bloqueado.
 */
export async function solicitarExportacao(ctx: TenantContext, patientId: string, deps: { db?: Db; now?: Date; boss?: PgBoss } = {}): Promise<string> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const boss = deps.boss ?? (await getBoss());
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).for('update');
      if (!p) throw new PacienteNaoEncontradoError();
      const [pendente] = await tx
        .select({ id: dataExports.id, createdAt: dataExports.createdAt })
        .from(dataExports)
        .where(and(eq(dataExports.patientId, p.id), eq(dataExports.status, 'pendente')));
      if (pendente && now.getTime() - pendente.createdAt.getTime() <= PENDENTE_MAX_MS) return pendente.id;
      if (pendente) await tx.update(dataExports).set({ status: 'falhou', updatedAt: now }).where(eq(dataExports.id, pendente.id));
      const [e] = await tx
        .insert(dataExports)
        .values({ tenantId: ctx.tenantId, patientId: p.id, solicitadoPor: ctx.actorUserId ?? null, createdAt: now, updatedAt: now })
        .returning({ id: dataExports.id });
      await recordAudit(tx, { acao: 'exportar', entidade: 'patients', entidadeId: p.id, patientId: p.id });
      const job = await boss.send('exportacao-paciente', { tenantId: ctx.tenantId, exportId: e.id }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou a exportação');
      return e.id;
    },
    deps.db ?? getDb(),
  );
}

export async function estadoDaExportacao(ctx: TenantContext, patientId: string, exportId: string, db: Db = getDb(), now: Date = new Date()): Promise<EstadoExportacao> {
  if (!idValido(patientId) || !idValido(exportId)) return { estado: 'inexistente' };
  const [e] = await withTenant(ctx, (tx) => tx.select().from(dataExports).where(and(eq(dataExports.id, exportId), eq(dataExports.patientId, patientId))), db);
  if (!e) return { estado: 'inexistente' };
  if (e.status === 'pendente' || e.status === 'falhou') return { estado: e.status };
  if (e.status === 'pronta' && e.arquivoPath && e.expiraEm && e.expiraEm.getTime() > now.getTime()) return { estado: 'pronta', caminho: e.arquivoPath, expiraEm: e.expiraEm };
  return { estado: 'expirada' };
}

export async function exportacoesRecentes(ctx: TenantContext, patientId: string, db: Db = getDb()) {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: dataExports.id, status: dataExports.status, createdAt: dataExports.createdAt, expiraEm: dataExports.expiraEm })
        .from(dataExports)
        .where(eq(dataExports.patientId, patientId))
        .orderBy(desc(dataExports.createdAt))
        .limit(5),
    db,
  );
}
```

- [ ] **Step 6: PDF e job (só worker)** — `src/modules/pacientes/prontuario-pdf.tsx`

```tsx
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { DadosExportacao } from './exportacao-job';

// Helvetica padrão do PDF (WinAnsi): cobre os acentos do português; o resto passa por paraWinAnsi (abaixo)
const s = StyleSheet.create({
  pagina: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  secao: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  linha: { flexDirection: 'row', gap: 8 },
  rotulo: { fontFamily: 'Helvetica-Bold' },
  rodape: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 8, color: '#555555', flexDirection: 'row', justifyContent: 'space-between' },
});

const br = (iso: string) => iso.split('-').reverse().join('/');
const num = (v: number | null) => (v === null ? '-' : String(v).replace('.', ','));

function Prontuario({ d, nutri }: { d: DadosExportacao; nutri: string }) {
  return (
    <Document title="Prontuário" author={nutri} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <Text style={s.titulo}>Prontuário nutricional</Text>
        <Text>{`${d.paciente.nome} · emitido em ${br(d.dataEmissao)} · ${nutri}`}</Text>

        <Text style={s.secao}>Identificação</Text>
        <Text>{`Nascimento: ${d.paciente.dataNascimento ? br(d.paciente.dataNascimento) : '-'} · Sexo: ${d.paciente.sexo ?? '-'} · E-mail: ${d.paciente.email} · Telefone: ${d.paciente.telefone ?? '-'}`}</Text>

        <Text style={s.secao}>Anamneses</Text>
        {d.anamneses.length === 0 && <Text>Nenhuma.</Text>}
        {d.anamneses.map((a, i) => (
          <View key={i} wrap={false}>
            <Text style={s.rotulo}>{`${br(a.data)} · ${a.modelo}`}</Text>
            {a.respostas.map((r, j) => <Text key={j}>{`${r.pergunta}: ${r.resposta}`}</Text>)}
          </View>
        ))}

        <Text style={s.secao}>Antropometria</Text>
        {d.antropometria.length === 0 && <Text>Nenhuma.</Text>}
        {d.antropometria.map((a, i) => (
          <Text key={i}>{`${br(a.data)}: peso ${num(a.pesoKg)} kg · altura ${num(a.alturaCm)} cm · IMC ${num(a.imc)} · % de gordura ${num(a.percGordura)}`}</Text>
        ))}

        <Text style={s.secao}>Gasto energético</Text>
        {d.gastoEnergetico.length === 0 && <Text>Nenhum.</Text>}
        {d.gastoEnergetico.map((g, i) => (
          <Text key={i}>{`${br(g.data)}: ${g.formula} · fator ${num(g.fatorAtividade)} · TMB ${g.tmbKcal} kcal · GET ${g.getKcal} kcal`}</Text>
        ))}

        <Text style={s.secao}>Exames</Text>
        {d.exames.length === 0 && <Text>Nenhum.</Text>}
        {d.exames.map((e, i) => (
          <View key={i} wrap={false}>
            <Text style={s.rotulo}>{`${br(e.data)} · ${e.titulo}${e.temLaudo ? ' (laudo anexado no sistema)' : ''}`}</Text>
            {e.valores.map((v, j) => <Text key={j}>{`${v.nome}: ${num(v.valor)}${v.unidade ? ` ${v.unidade}` : ''}${v.referencia ? ` (referência ${v.referencia})` : ''}`}</Text>)}
          </View>
        ))}

        <Text style={s.secao}>Orientações dos atendimentos</Text>
        {d.atendimentos.length === 0 && <Text>Nenhuma.</Text>}
        {d.atendimentos.map((a, i) => <Text key={i}>{`${br(a.data)}: ${a.orientacoes ?? '-'}`}</Text>)}

        <View style={s.rodape} fixed>
          <Text>Dados exportados do NutriDebby (LGPD, art. 18)</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/**
 * A Helvetica padrão só tem o conjunto WinAnsi: "≥ 40" (referência de exame), "−", emoji e afins sairiam
 * como outro caractere, sem erro. Troca os comuns por equivalentes e o resto por "?".
 */
const EQUIVALENTES: Record<string, string> = { '≥': '>=', '≤': '<=', '−': '-', '→': '->' };
const FORA_DO_WINANSI = /[^\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/gu;
export function paraWinAnsi(t: string): string {
  return t.replace(/[≥≤−→]/g, (c) => EQUIVALENTES[c] ?? c).replace(FORA_DO_WINANSI, '?');
}

export async function renderizarProntuario(dados: DadosExportacao, nutri: string): Promise<Buffer> {
  const limpo = JSON.parse(JSON.stringify(dados), (_k, v: unknown) => (typeof v === 'string' ? paraWinAnsi(v) : v)) as DadosExportacao;
  return renderToBuffer(<Prontuario d={limpo} nutri={paraWinAnsi(nutri)} />);
}
```

`src/modules/pacientes/exportacao-job.ts`

```ts
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Db, Tx } from '@/db/client';
import { anamneses, anthropometry, consultations, dataExports, energyCalcs, exams, patients, privacyRequests, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getBoss } from '@/jobs/boss';
import { getEnv } from '@/env';
import { logger } from '@/lib/logger';
import { apagarArquivo, CotaEsgotadaError, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { buscarTenant, listarTenantsParaVarredura, tenantIsActive } from '@/modules/plataforma/tenant-status';
import { respostaParaCampo } from './anamnese-tipos';
import { hojeNoFuso } from './datas';
import { EXPORTACAO_VALIDADE_MS, linkDaExportacao } from './exportacao';
import { FORMULAS_TMB, kcal } from './formulas';
import { formatarTelefone } from './telefone';
import { renderizarProntuario } from './prontuario-pdf';

// Só o worker importa este arquivo (e o PDF): @react-pdf/renderer fica fora do grafo do Next.

export type DadosExportacao = {
  versao: 1;
  geradoEm: string;
  /** Data da emissão no fuso do tenant (RN-06): 22h em São Paulo ainda é o mesmo dia. */
  dataEmissao: string;
  paciente: { nome: string; dataNascimento: string | null; sexo: string | null; email: string; telefone: string | null; status: string; cadastradoEm: string };
  anamneses: { data: string; modelo: string; respostas: { pergunta: string; resposta: string }[] }[];
  antropometria: { data: string; pesoKg: number; alturaCm: number; imc: number | null; percGordura: number | null; protocolo: string; circunferencias: Record<string, number>; dobrasMm: Record<string, number> }[];
  gastoEnergetico: { data: string; formula: string; pesoKg: number; alturaCm: number; idade: number; fatorAtividade: number; tmbKcal: number; getKcal: number }[];
  exames: { data: string; titulo: string; temLaudo: boolean; valores: { nome: string; valor: number; unidade: string | null; referencia: string | null }[] }[];
  /** Só as orientações: notas privadas (staff_only) nunca saem (US-016). */
  atendimentos: { data: string; orientacoes: string | null }[];
  pedidosLgpd: { tipo: string; status: string; prazo: string; concluidoEm: string | null }[];
};

const texto = (v: string | string[]) => (Array.isArray(v) ? v.join(', ') : v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : v);
const NOME_FORMULA = Object.fromEntries(FORMULAS_TMB.map((f) => [f.id, f.nome]));

/**
 * Todas as tabelas do paciente, menos as staff_only (notas privadas, etiquetas). Consultas em sequência:
 * uma transação é uma conexão só, e consultas paralelas nela geram o aviso de descontinuação do pg 8.23
 * (erro no pg 9).
 */
export async function montarDados(tx: Tx, patientId: string, now: Date, fuso: string): Promise<DadosExportacao> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
  const as = await tx.select().from(anamneses).where(eq(anamneses.patientId, patientId)).orderBy(asc(anamneses.data));
  const an = await tx.select().from(anthropometry).where(eq(anthropometry.patientId, patientId)).orderBy(asc(anthropometry.data));
  const gs = await tx.select().from(energyCalcs).where(eq(energyCalcs.patientId, patientId)).orderBy(asc(energyCalcs.createdAt));
  const ex = await tx.select().from(exams).where(eq(exams.patientId, patientId)).orderBy(asc(exams.data));
  const at = await tx
    .select({ data: consultations.data, orientacoes: consultations.orientacoesPaciente })
    .from(consultations)
    .where(eq(consultations.patientId, patientId))
    .orderBy(asc(consultations.data));
  const pr = await tx.select().from(privacyRequests).where(eq(privacyRequests.patientId, patientId)).orderBy(asc(privacyRequests.createdAt));
  return {
    versao: 1,
    geradoEm: now.toISOString(),
    dataEmissao: hojeNoFuso(fuso, now),
    paciente: {
      nome: p.nome,
      dataNascimento: p.dataNascimento,
      sexo: p.sexo,
      email: p.email,
      telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : null,
      status: p.status,
      cadastradoEm: p.createdAt.toISOString(),
    },
    anamneses: as.map((a) => ({
      data: a.data,
      modelo: a.templateSnapshot.nome,
      respostas: a.templateSnapshot.perguntas
        .filter((q) => a.respostas[q.id] !== undefined)
        .map((q) => ({ pergunta: q.rotulo, resposta: texto(respostaParaCampo(a.respostas[q.id])) })),
    })),
    antropometria: an.map((a) => ({
      data: a.data, pesoKg: a.pesoKg, alturaCm: a.alturaCm, imc: a.imc, percGordura: a.percGordura, protocolo: a.protocolo, circunferencias: a.circunferencias, dobrasMm: a.dobrasMm,
    })),
    gastoEnergetico: gs.map((g) => ({
      data: hojeNoFuso(fuso, g.createdAt), formula: NOME_FORMULA[g.formula] ?? g.formula, pesoKg: g.pesoKg, alturaCm: g.alturaCm, idade: g.idade,
      fatorAtividade: g.fatorAtividade, tmbKcal: kcal(g.tmb), getKcal: kcal(g.get),
    })),
    exames: ex.map((e) => ({ data: e.data, titulo: e.titulo, temLaudo: !!e.arquivoPath, valores: e.valores })),
    atendimentos: at,
    pedidosLgpd: pr.map((r) => ({ tipo: r.tipo, status: r.status, prazo: r.prazo, concluidoEm: r.concluidoEm?.toISOString() ?? null })),
  };
}

type DadosJob = { tenantId: string; exportId: string };
type DepsJob = {
  db: Db;
  dataDir: string;
  appUrl: string;
  now?: Date;
  boss?: PgBoss;
  /** pg-boss: esta é a última tentativa (retryCount ≥ retryLimit) — em erro, marca "falhou". */
  ultimaTentativa: boolean;
  /** Testes trocam o PDF. */
  renderizar?: typeof renderizarProntuario;
};

/** Outro worker marcou o pedido antes: o `registrar` desiste e o salvarArquivo desfaz ZIP, registro e cota. */
class JaConcluidaError extends Error {}

/**
 * Job `exportacao-paciente`. Idempotente: só age sobre pedido `pendente` (um retry depois do sucesso
 * não gera outro ZIP). Tenant suspenso: não gera (RN-15) e marca "falhou" — senão o pedido ficaria
 * pendente para sempre e "Exportar dados" devolveria o mesmo id sem job. Erro: o pg-boss tenta de novo;
 * na última tentativa, "falhou" (a nutricionista pede de novo). ZIP, pedido "pronta", e-mail e job de
 * expiração vão na MESMA transação (`registrar`): uma queda no meio não deixa ZIP sem dono em /data.
 */
export async function gerarExportacao(data: DadosJob, deps: DepsJob): Promise<'pronta' | 'ignorada' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const marcarFalhou = () =>
    withTenant(ctx, (tx) => tx.update(dataExports).set({ status: 'falhou', updatedAt: now }).where(and(eq(dataExports.id, data.exportId), eq(dataExports.status, 'pendente'))), db);
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorada';
  }
  const [pedido] = await withTenant(ctx, (tx) => tx.select().from(dataExports).where(and(eq(dataExports.id, data.exportId), eq(dataExports.status, 'pendente'))), db);
  if (!pedido) return 'ignorada';
  try {
    const tenant = await buscarTenant(db, data.tenantId);
    const dados = await withTenant(ctx, (tx) => montarDados(tx, pedido.patientId, now, tenant?.fuso ?? 'America/Sao_Paulo'), db);
    const pdf = await (deps.renderizar ?? renderizarProntuario)(dados, tenant?.nomeExibicao ?? 'NutriDebby');
    const zip = zipSync({ 'dados.json': strToU8(JSON.stringify(dados, null, 2)), 'prontuario.pdf': new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.length) });
    const boss = deps.boss ?? (await getBoss());
    const expiraEm = new Date(now.getTime() + EXPORTACAO_VALIDADE_MS);
    await salvarArquivo(
      ctx,
      {
        tipo: 'exportacao',
        conteudo: Buffer.from(zip.buffer, zip.byteOffset, zip.length),
        permitidos: ['zip'],
        registrar: async (tx, arquivo) => {
          const [e] = await tx
            .update(dataExports)
            .set({ status: 'pronta', arquivoPath: arquivo.caminho, expiraEm, updatedAt: now })
            .where(and(eq(dataExports.id, pedido.id), eq(dataExports.status, 'pendente')))
            .returning({ id: dataExports.id });
          if (!e) throw new JaConcluidaError();
          const [quem] = pedido.solicitadoPor ? await tx.select({ email: user.email }).from(user).where(eq(user.id, pedido.solicitadoPor)) : [];
          if (quem) await enqueueEmail({ tipo: 'exportacao_pronta', para: quem.email, link: linkDaExportacao(deps.appUrl, pedido.patientId, pedido.id) }, { tenantId: data.tenantId, tx, boss });
          await boss.send('expirar-exportacao', data, { startAfter: expiraEm, db: fromDrizzle(tx, sql) });
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return 'pronta';
  } catch (err) {
    if (err instanceof JaConcluidaError) return 'ignorada';
    const definitivo = deps.ultimaTentativa || err instanceof CotaEsgotadaError;
    logger.error({ err: err instanceof Error ? err.message : String(err), tenantId: data.tenantId, exportId: data.exportId, definitivo }, 'falha ao gerar exportação');
    if (!definitivo) throw err;
    await marcarFalhou();
    return 'falhou';
  }
}

/**
 * Rede de segurança do "some em 24 h", chamada pelo job diário `retencao-lgpd`: pedidos prontos já
 * vencidos (o `expirar-exportacao` esgotou as tentativas) perdem o ZIP; pendentes esquecidos há mais de
 * um dia (worker caiu na última tentativa) viram "falhou".
 */
export async function expirarExportacoesVencidas(db: Db, now: Date, deps: { dataDir?: string } = {}): Promise<{ expiradas: number }> {
  let expiradas = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    try {
      const vencidas = await withTenant(
        ctx,
        (tx) => tx.select({ id: dataExports.id }).from(dataExports).where(and(eq(dataExports.status, 'pronta'), lt(dataExports.expiraEm, now))),
        db,
      );
      for (const { id } of vencidas) {
        await expirarExportacao({ tenantId: t.id, exportId: id }, { db, dataDir: deps.dataDir ?? getEnv().DATA_DIR });
        expiradas++;
      }
      await withTenant(
        ctx,
        (tx) =>
          tx
            .update(dataExports)
            .set({ status: 'falhou', updatedAt: now })
            .where(and(eq(dataExports.status, 'pendente'), lt(dataExports.createdAt, new Date(now.getTime() - EXPORTACAO_VALIDADE_MS)))),
        db,
      );
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), tenantId: t.id }, 'falha ao expirar exportações vencidas');
    }
  }
  return { expiradas };
}

/** Job `expirar-exportacao` (24 h depois): apaga o ZIP e marca o pedido como expirado. */
export async function expirarExportacao(data: DadosJob, deps: { db: Db; dataDir: string }): Promise<void> {
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const [e] = await withTenant(ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, data.exportId)), deps.db);
  if (!e) return;
  if (e.arquivoPath) await apagarArquivo(ctx, { caminho: e.arquivoPath }, deps);
  await withTenant(ctx, (tx) => tx.update(dataExports).set({ status: 'expirada', arquivoPath: null, updatedAt: new Date() }).where(eq(dataExports.id, e.id)), deps.db);
}
```

Em `src/modules/pacientes/lgpd.ts`, trocar `anexosDoPaciente` por (import `dataExports`):

```ts
/** Arquivos em /data ligados ao paciente: laudos e exportações. */
export async function anexosDoPaciente(tx: Tx, patientId: string): Promise<string[]> {
  const deExames = await tx.select({ c: exams.arquivoPath }).from(exams).where(and(eq(exams.patientId, patientId), isNotNull(exams.arquivoPath)));
  const deExportacoes = await tx.select({ c: dataExports.arquivoPath }).from(dataExports).where(and(eq(dataExports.patientId, patientId), isNotNull(dataExports.arquivoPath)));
  return [...deExames, ...deExportacoes].map((e) => e.c!);
}
```

Run: `pnpm test src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts`
Expected: PASS.

- [ ] **Step 7: Worker** — em `src/worker/index.ts` (imports `gerarExportacao`, `expirarExportacao`, `expirarExportacoesVencidas` de `@/modules/pacientes/exportacao-job`). No handler da `retencao-lgpd` (Tarefa 13), depois do `logger.info` da anonimização, acrescentar a rede de segurança das 24 h:

```ts
    const x = await expirarExportacoesVencidas(getDb(), new Date(), { dataDir: env.DATA_DIR });
    logger.info({ expiradas: x.expiradas }, 'exportações vencidas apagadas');
```

E, depois do bloco da `retencao-lgpd`:

```ts
  // US-018: exportação do paciente (ZIP com JSON + PDF) e expiração do link em 24 h
  await boss.work<{ tenantId: string; exportId: string }>('exportacao-paciente', { includeMetadata: true }, async ([job]) => {
    await gerarExportacao(job.data, { db: getDb(), dataDir: env.DATA_DIR, appUrl: env.APP_URL, boss, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
  await boss.work<{ tenantId: string; exportId: string }>('expirar-exportacao', async ([job]) => {
    await expirarExportacao(job.data, { db: getDb(), dataDir: env.DATA_DIR });
  });
```

- [ ] **Step 8: Telas** — em `src/app/painel/pacientes/[id]/privacidade/actions.ts`, acrescentar:

```ts
import { redirect } from 'next/navigation';
import { solicitarExportacao } from '@/modules/pacientes/exportacao';

export async function exportarAction(patientId: string): Promise<void> {
  const { ctx } = await requireNutri(caminho(patientId));
  let id: string;
  try {
    id = await solicitarExportacao(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/exportacoes/${id}`);
}
```

Em `src/app/painel/pacientes/[id]/privacidade/page.tsx`: importar `exportacoesRecentes` (`@/modules/pacientes/exportacao`), `exportarAction` e `Link`; trocar `const { tenant, paciente } = …` por `const { ctx, tenant, paciente } = …`, buscar `const recentes = await exportacoesRecentes(ctx, paciente.id);` e acrescentar, entre "Arquivamento" e "Pedido de exclusão":

```tsx
      <section aria-labelledby="exportacao" className="space-y-2">
        <h2 id="exportacao" className="text-lg font-semibold">Exportar dados (LGPD)</h2>
        <p>Gera um ZIP com dados.json e prontuario.pdf de todo o prontuário, sem as notas privadas e sem as etiquetas. O link chega por e-mail e vale por 24 horas.</p>
        <form action={exportarAction.bind(null, paciente.id)}>
          <button className="rounded border px-4 py-2">Exportar dados</button>
        </form>
        {recentes.length > 0 && (
          <ul className="text-sm">
            {recentes.map((r) => (
              <li key={r.id}>
                <Link href={`/painel/pacientes/${paciente.id}/exportacoes/${r.id}`} className="underline">{`Pedida em ${formatarDataHora(r.createdAt, tenant.fuso)}`}</Link>
                {` · ${{ pendente: 'gerando', pronta: 'pronta', falhou: 'falhou', expirada: 'expirada' }[r.status] ?? r.status}`}
              </li>
            ))}
          </ul>
        )}
      </section>
```

`src/app/painel/pacientes/[id]/exportacoes/[exportId]/page.tsx`

```tsx
import Link from 'next/link';
import { signFileUrl } from '@/lib/signed-url';
import { estadoDaExportacao } from '@/modules/pacientes/exportacao';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../../prontuario';

export const dynamic = 'force-dynamic';

/** Destino do link do e-mail (24 h). O download em si é por URL assinada de 5 min (CLAUDE.md regra 9). */
export default async function ExportacaoPage({ params }: PageProps<'/painel/pacientes/[id]/exportacoes/[exportId]'>) {
  const { id, exportId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const e = await estadoDaExportacao(ctx, paciente.id, exportId);
  const privacidade = `/painel/pacientes/${paciente.id}/privacidade`;
  return (
    <section aria-labelledby="exportacao-titulo" className="max-w-2xl space-y-3">
      <h2 id="exportacao-titulo" className="text-lg font-semibold">Exportação de dados</h2>
      {e.estado === 'pronta' && (
        <>
          <p>{`Pronta. O link vale até ${formatarDataHora(e.expiraEm, tenant.fuso)}.`}</p>
          <a href={signFileUrl(e.caminho)} className="inline-block rounded bg-emerald-700 px-4 py-2 text-white">Baixar ZIP</a>
        </>
      )}
      {e.estado === 'pendente' && <p role="status">A exportação ainda está sendo gerada. Atualize a página em alguns instantes.</p>}
      {e.estado === 'expirada' && <p role="status">Este link expirou. Gere uma nova exportação na aba Privacidade.</p>}
      {e.estado === 'falhou' && <p role="alert">Não foi possível gerar a exportação. Gere de novo na aba Privacidade.</p>}
      {e.estado === 'inexistente' && <p role="alert">Exportação não encontrada.</p>}
      <p><Link href={privacidade} className="underline">Voltar para Privacidade</Link></p>
    </section>
  );
}
```

- [ ] **Step 9: CLAUDE.md** — na regra 1, na lista de quem acessa a tabela `user` fora de `withTenant`, acrescentar `, por src/modules/pacientes/exportacao-job.ts (e-mail de quem pediu a exportação, US-018)`; e na regra 9, acrescentar ao fim: `A exportação (ZIP) é o único uso de 'zip' em permitidos; PDF e ZIP (@react-pdf/renderer, fflate) só no worker — nenhuma rota importa exportacao-job.ts (teste em exportacao.test.ts).`

- [ ] **Step 9b: Backup sem os ZIPs de exportação** (decisão do dono em 2026-09-30, seguindo a recomendação) — o `rclone sync` de `/data` copiava o ZIP para o R2, e depois de apagado ele ficava mais 30 dias no `--backup-dir`, contra o "some em 24 h" (US-018). O ZIP é derivado do banco (que tem backup próprio), então não precisa de cópia. Em `scripts/backup/nutri-backup.sh`, em `backup_arquivos`, trocar a linha do `rclone sync` por:

```bash
  # US-018: o ZIP de exportação vive 24 h e é refeito a partir do banco; fora do backup para não sobreviver 30 dias no histórico
  if rclone sync "$NUTRI_DATA_DIR" "${REMOTO}data/atual" --backup-dir "${REMOTO}data/historico/${HOJE}" --exclude '/*/exportacao/**' >/dev/null 2>&1; then
```

Em `test/backup.test.ts`, no teste "dia seguinte…", antes do `rodar('2026-10-05')`, acrescentar `mkdirSync(path.join(dados, 't1', 'exportacao'), { recursive: true }); writeFileSync(path.join(dados, 't1', 'exportacao', 'e.zip'), 'zip');` e, depois das asserções existentes:

```ts
    expect(await lsf('data/atual/t1/')).toEqual(['logo/']); // o ZIP de exportação não vai para o R2
    expect(await lsf('data/historico/2026-10-05/t1/')).not.toContain('exportacao/');
```

Run: `pnpm test test/backup.test.ts` (é o único jeito permitido de rodar o script — CLAUDE.md regra 10)
Expected: PASS.

**Regra 10:** o script mudou → o dono reinstala no host. Como a instalação ainda não aconteceu (P02-11 pendente, depende da P01-13), basta a P02-11 instalar a versão nova; registrar isso na descrição do PR.

- [ ] **Step 10: Suíte, imagem e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde. Conferir também que o PDF e o ZIP ficaram fora do bundle do Next (o teste do Step 4 só olha imports diretos de `src/app`): `grep -rlE "@react-pdf|fflate" .next/server .next/static` não acha nada. Com o worker e o `next start` no ar, conferir à mão uma vez: "Exportar dados" → e-mail no Mailpit → link → "Baixar ZIP" abre o download, e o `prontuario.pdf` do ZIP abre com acentos corretos.

```bash
git add package.json pnpm-lock.yaml src/lib src/app/api/arquivos src/db/schema/pacientes.ts drizzle/0033_exportacoes.sql drizzle/0034_rls_exportacoes.sql drizzle/meta \
  test/isolamento.test.ts src/modules/pacientes src/modules/plataforma/audit.ts src/email src/jobs/queues.ts src/worker/index.ts src/app/painel/pacientes CLAUDE.md \
  scripts/backup/nutri-backup.sh test/backup.test.ts
git commit -m "feat(pacientes): exportação LGPD em ZIP (dados.json + prontuario.pdf) pelo worker, link de 24 h e expiração (P03-11b)

@react-pdf/renderer <versão> e fflate <versão> (só no worker)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Depois do push: conferir no job `image` do CI a linha "Imagem comprimida: N MB (limite 260 MB)". Acima do limite → parar e avisar o dono (Global Constraints).

---
## Fechamento do plano (após a Tarefa 14)

- [ ] Rodar a revisão da entrega conforme o índice: revisor por tarefa (feito ao longo) → `/code-review high` no PR (base `plano-02-plataforma`) → corrigir → `/code-review high` (precisa sair sem problema confirmado) → `/security-review` com o **checklist reforçado** deste plano:
  - **Isolamento:** RLS por tenant e por paciente em toda tabela nova; `staff_only` em `consultation_notes`, `patient_tags`, `patient_tag_links` (paciente não vê nem as próprias linhas); FKs compostas/triplas impedindo referência cruzada; matriz `test/isolamento.test.ts` com todas as tabelas; `invites` como exceção justificada e sempre filtrada por tipo e tenant; guarda `sem-tabelas-tenant` derivada do schema.
  - **LGPD:** `auditRead` em toda leitura de dado de saúde (prontuário, anamnese, antropometria, gasto, exames, atendimentos, notas, etiquetas, evolução); `exportar`, `bloquear`, `anonimizar` registrados; exportação sem notas privadas e etiquetas; bloqueio só leitura; anonimização idempotente que apaga anexos; e-mails de sistema sem dado do paciente (o de exclusão vai só para o próprio titular).
  - **Uploads:** laudo por conteúdo (PDF/JPEG/PNG), 20 MB com corpo limitado, cota, URL assinada de 5 min, `zip` aceito só pela exportação e servido como anexo; PDF servido como anexo; laudo e exame, ZIP e pedido gravados na mesma transação; ZIP fora do backup do R2.
  - **Autenticação:** convite de paciente só em hash, 7 dias, uso único mesmo com envios simultâneos; conta existente só vincula com o mesmo e-mail; e-mail de conta da equipe recusado; tenant suspenso barra o aceite.
  - **Logs:** nenhum nome, medida, resposta, nota ou valor de exame em log/erro.
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema confirmado depois da 3ª rodada, parar e avisar o dono.
- [ ] Atualizar o status de P03-01 a P03-11 no backlog (arquivo `2026-09-27-nutridebby-backlog.md` — que ainda mostra os Planos 01 e 02 como ⬜; acertar também essas linhas — e o artefato https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT, coleção `tasks`).
- [ ] Atualizar a spec para a **v1.5** (Apêndice C e corpo) com os "Desvios conscientes" desta página: convite/aceite do paciente no Plano 03 (e o que ficou para o 06), termo provisório, `consultation_notes` + `staff_only`, FKs compostas, `anamnesis_templates.padrao/arquivado_em`, `data_exports`, `exams.arquivo_path` com FK, gráficos sem Recharts, `@react-pdf/renderer` e `fflate` só no worker, `PRAZO_GUARDA_ANOS`, métrica de pacientes ativos, `consents.tenant_id`, laudo PDF como download, ZIP de exportação fora do backup (RNF-05), conta `user` do titular anonimizada só no P06-08, textos novos de interface — e a **divergência do Harris-Benedict** (1370,47 → 1370, não 1371) para a Debby validar (P-08).
- [ ] Anotar para os próximos planos:
  - **P04-05:** botão "Usar como meta do plano" (`meal_plans.energy_calc_id` → `energy_calcs`); **P04-09:** reaproveitar `@react-pdf/renderer` (já na imagem) e `getTenantBrand`.
  - **Plano 05:** `consultations.appointment_id` + "Iniciar atendimento" a partir da agenda; lembretes só para `patients.status = 'ativo'` e WhatsApp só com `whatsapp_optin_em` preenchido **e** `whatsapp_optout_em` vazio; **P05-11** convite por WhatsApp (US-010); inscrições de push apagadas em `atenderPedidoExclusao`; `admin_tenant_metrics()` troca `consultas_mes`/`mensagens_whatsapp_mes`.
  - **Plano 06:** login do paciente com vários vínculos — a busca "em quais tenants este `user_id` é paciente" precisa atravessar a RLS de `patients` (função `SECURITY DEFINER` que devolve só `tenant_id`/`patient_id`/`status`, no molde de `admin_tenant_metrics`); portal bloqueado para vínculo `arquivado`/`bloqueado` (RN-08); `orientacoesDoPaciente` e `GraficoLinha` reaproveitados; "Minha evolução" respeitando `mostrar_perc_gordura_paciente`; US-046 reaproveita `solicitarExportacao` e registra `privacy_requests` abertos; novo aceite quando `TERMO_PACIENTE_VERSAO` mudar; "Perfil > Notificações" grava `whatsapp_optout_em`; fotos do diário apagadas em `atenderPedidoExclusao` e incluídas em `anexosDoPaciente`; **P06-08:** a anonimização passa a apagar nome e e-mail da linha `user` do titular que não tiver outro vínculo ativo (decisão do dono, 2026-09-30). **Exclusão de conta do paciente (achado na revisão da Tarefa 14):** `patients.user_id` tem FK `ON DELETE SET NULL` para `user`; apagar a conta dispara o UPDATE em `patients`, o gatilho de auditoria roda sem `app.tenant_id` e a RLS de `audit_log` barra (42501) — hoje latente (nenhum código apaga conta de paciente, e `consents` com FK `NO ACTION` falharia antes). Quando existir a exclusão de conta: desvincular antes com `withTenant` (`user_id = null`) e tratar `consents`, ou remover a FK como na migration 0037 (`data_exports.solicitado_por`).
  - **Plano 07:** a audiência por etiqueta é avaliada na leitura (RN-12), mas `patient_tag_links` é `staff_only` — a sessão de paciente não enxerga os próprios vínculos. A checagem de audiência precisa de uma função `SECURITY DEFINER` que responda só "este conteúdo é visível para este paciente?" (sem devolver as etiquetas), ou ser resolvida fora da sessão do paciente.
- [ ] Lembrar o dono: **P01-13 (Easypanel + primeiro deploy) continua pendente**; o merge dos PRs #1, #2 e deste só com OK explícito (merge = deploy), com snapshot no hPanel antes.

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec** — cada requisito do Plano 03 tem tarefa:

| Requisito | Tarefa |
|---|---|
| US-010 campos, validações e erros exatos; ativo/`user_id` nulo; ≥ 18 anos (RN-17) no fuso | 1 (telas 2) |
| US-010 convite por e-mail de 7 dias; "conta existente"; autorização de WhatsApp da nutricionista | 3 (e 1 para `whatsapp_optin_origem = 'nutri'`); convite por WhatsApp → P05-11 (desvio) |
| US-011 senha, termo versionado, botão desabilitado, opt-in/opt-out no aceite | 4; "Revogar em Perfil" e "Nova versão do termo" → Plano 06 (desvio) |
| US-012 7 tipos, modelo padrão, snapshot, obrigatória | 9 |
| US-013 IMC, JP3/JP7 + Siri, dobra faltando, faixa de peso | 6 (fórmulas), 7 |
| US-014 comparar fórmulas, fator, arredondamento, idade | 6, 8; "Usar como meta" → P04-05 (desvio) |
| US-015 laudo 20 MB, URL assinada, erro exato, valores e gráfico | 11, 12 |
| US-016 notas × orientações, "nem no JSON" | 10 (+ `staff_only` da 5); "Iniciar atendimento" da agenda → Plano 05 (desvio) |
| US-017 gráficos, diferença "−3,2 kg", poucos dados | 12 |
| US-018 arquivar, exportar ZIP/24 h/auditoria, exclusão com bloqueio, anonimização | 13, 14 |
| US-019 filtrar por etiqueta, paciente não vê | 5 |
| US-006 404 por id de outro tenant; isolamento por paciente | 1 (API + matriz), todas as tabelas |
| US-007 aba "Histórico de acessos" no prontuário | 2 |
| RN-14, Apêndice A (casos obrigatórios ±0,01) | 6 |
| RNF-07 / RNF-08 / RNF-11 / RNF-12 | todas (matriz, `auditRead`, logs sem dado, formatos) |
| §3 métrica de pacientes ativos | 1 |

Sem lacunas além dos desvios registrados.

**2. Placeholders** — procurados "TBD", "TODO", "implementar depois", "tratar erros", "igual à Tarefa N": nenhum. Os únicos `<…>` são as versões de `@react-pdf/renderer`/`fflate` no commit da Tarefa 14 (dependem do gate do pnpm na hora, com instrução explícita) e `<tabela>`/`<id>` em textos de regra.

**3. Consistência de tipos e nomes** — conferidos entre tarefas: `TenantDoPaciente`/`{ fuso; nomeExibicao }` (T1) em T3/T13; `carregarPacienteParaEscrita`, `idValido`, `PacienteNaoEncontradoError`, `PacienteBloqueadoError`, `MSG_CADASTRO_INCOMPLETO` (T1 `base.ts`) em T3–T14; `enviarConvitePaciente(tx, p, { appUrl, nutri, now })` (T3) em `criarPaciente`/`atualizarPaciente`; `ConvitePacienteError`/`MSG_CONVITE_PACIENTE` (T3) em T4; `STAFF_ONLY`/`app_enable_staff_only` (T5) em T10; `decimalEntre`/`decimalOpcionalEntre`/`arredondar`/`formatarDecimal`/`lerDecimal` (T6) em T7/T8/T9/T11/T12; `calcularGordura`/`dobrasDoProtocolo`/`DOBRAS`/`kcal`/`FORMULAS_TMB` (T6) em T7/T8/T14; `MSG_ANTROPO`, `entradaDoFormulario`, `listarAntropometrias` (T7) em T8/T10/T12/T14; `EntradaAntropometria.consultationId` (T10) no formulário da T7; `respostaParaCampo`/`Pergunta` (T9) em T14; `marcadoresDoPaciente`/`SerieMarcador` (T11) em T12; `anexosDoPaciente` (T13) estendida na T14; `somarAnos`/`somarDias` (T13) em `lgpd.ts`; `EXPORTACAO_VALIDADE_MS`/`linkDaExportacao` (T14 app) no job; `emailsNaFila`, `novoTenant`, `novoPaciente`, `ctxPaciente` (T1 `test/pacientes.ts`) em todos os testes; `ABAS` recebe uma entrada por tarefa (T7–T13), sempre antes de `historico`.

**4. Review Focus** — os cinco itens têm teste na tarefa dona: (1) T1 `datas.test.ts` "hojeNoFuso usa o fuso do tenant" e `pacientes.test.ts` "18 anos no fuso do tenant"; (2) T6 `numero.test.ts` "números digitados em pt-BR" e T7 "Valor fora da faixa e números digitados do jeito brasileiro"; (3) T4 "duplo clique em Continuar" e "conta de outro e-mail ou e-mail que é de nutricionista"; (4) T1 `route.test.ts` (404) e `pacientes.test.ts` ("outro tenant ou malformado"), T7 "FK composta no banco", T10 "FK tripla"; (5) T1 "e-mail repetido … mesmo em envios simultâneos" e T3 "três cadastros simultâneos … um convite só".

## Execução

Plano pronto em `docs/superpowers/plans/2026-09-29-nutridebby-03-prontuario.md`. Recomendação: **subagent-driven** — 14 tarefas encadeadas por interfaces (o `base.ts` e a matriz de isolamento da T1, o `staff_only` da T5, as fórmulas da T6 e a antropometria da T7 alimentam o resto), um erro de isolamento ou de LGPD aqui expõe dado de saúde, e a política do dono já exige um revisor por tarefa.
