# NutriDebby — Ficha e cadastro do paciente (Plano 18) — Design

| Item | Valor |
|---|---|
| Versão | 0.3 (17/11/2026: revisão do plano — executabilidade, banco/guardas e conflitos com os Planos 17, 19 e 20 —, no §15.4). 0.2: revisão de 16/11/2026 (lentes banco/RLS, normas CFN/LGPD, interface e completude; §15.3) |
| Data | 2026-11-16 |
| Status | **Decisões do dono tomadas** em 16/11/2026 ("aprovo todas as recomendações, pode seguir": perguntas 1 a 6 da proposta, §15). Revisada; plano de implementação em `docs/superpowers/plans/2026-11-16-nutridebby-18-ficha-cadastro.md`. **Pede o OK explícito do dono** às trocas de recomendações já aprovadas listadas no §15.2 (D1 e D16 principalmente). Conferida contra o código da `main` 5482450 (última migration: `0117_ia_nutri_funcoes.sql`) e contra o branch `plano-17-lembretes-rotina` (worktree `nutridebby-a`, commit f92a4ed, migrations `0118` a `0120`) |
| Itens do backlog | Paridade Dietbox, onda 1: **PD-10** (cadastro ampliado), **PD-11** (lista de pacientes), **PD-12** (ficha "Início": cabeçalho, botão Adicionar, seções com contador — **fundação** que outros planos usam) e **PD-13** ("O que está no app") |
| Quando | **Plano 18**, em paralelo com os Planos 17 (`nutridebby-a`), 19 (`nutridebby-b`) e 20 (`nutridebby-c`). Regras de convivência em `docs/operacao/sessoes-paralelas.md` (branch `docs/sessoes-paralelas`) |
| Documentos de base | [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) (RN-06, RN-08, RN-17), [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (US-007, US-010, US-018, US-019), [`2026-10-03-nutridebby-documentos-assinados-design.md`](2026-10-03-nutridebby-documentos-assinados-design.md) (D17: listas sem conteúdo; `tenant_signer`, CPF fora de tabela lida em contexto público), [`2026-10-08-nutridebby-app-paciente-g-design.md`](2026-10-08-nutridebby-app-paciente-g-design.md) (RN-203, "Não mostrar peso no app"), manual técnico caps. [02](../../manual-tecnico/02-banco-de-dados.md) (§2.5.4) e [04](../../manual-tecnico/04-modulos-clinicos.md) (§4.2) |
| Referência funcional | Dietbox (cadastro, lista, ficha e "Disponível no app"). Copiamos a **função**, nunca marca, texto ou layout |
| Numeração nova | US-260 a US-264 · RN-260 a RN-284 · RNF-260 a RNF-264 · CS-260 a CS-263 · R-260 a R-270 · D1 a D26 (decisões deste documento, citadas fora dele como "Plano 18, Dn"). A faixa 220–259 ficou de propósito para as specs dos Planos 19 e 20, escritas ao mesmo tempo a partir da mesma `main` (a próxima livre que elas vão achar é a 220). Quem fizer merge depois confere colisão com `grep -rhoE '\b(US|RN|RNF|CS|R)-2[2-9][0-9]\b' docs` |

---

## 1. Contexto e objetivo

Hoje a nutricionista cadastra só o básico (nome, nascimento, sexo, e-mail e um telefone), acha o paciente numa lista
com um seletor de situação e abre uma ficha de 12 abas cuja primeira, "Resumo", é na prática o formulário de cadastro.
Para saber o que já foi feito com o paciente ela precisa abrir aba por aba, e não há no painel nenhuma visão do que o
paciente enxerga no app.

O Plano 18 resolve quatro coisas:

1. **Cadastro completo** (PD-10): os dados de identificação que a Res. CFN 594/2017 (art. 4º, § 1º, I) manda registrar
   na primeira consulta, mais CPF, telefone fixo e uma observação — todos opcionais.
2. **Lista de pacientes prática** (PD-11): abas Ativos / Inativos / Todos, ordenação, data de cadastro e um menu por
   linha (abrir, editar, arquivar ou reativar, pedir exclusão).
3. **Ficha "Início"** (PD-12): o cabeçalho passa a mostrar as medidas da última avaliação; a primeira aba vira "Início",
   com um botão **Adicionar** único e **seções com contador** (plano, avaliações, atendimentos, exames, documentos); o
   cadastro vai para a aba nova "Perfil". As seções são um **registro** em que os próximos planos penduram as suas sem
   mexer na página — é a fundação da onda.
4. **"No app do paciente"** (PD-13): um cartão no Início e uma página de detalhe dizendo se o paciente já entrou no app
   e o que ele vê lá, contado com as **mesmas regras** do portal.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-260 | A nutricionista chega a qualquer registro do paciente (criar ou abrir) a partir do Início em **≤ 2 cliques** | E2E: do Início, "Adicionar" → tipo (2 cliques) e seção → item (2 cliques), para cada seção do registro. Na Anamnese, os 2 cliques levam ao seletor de modelo da aba (escolher o modelo já é preencher o formulário, D25); Receita e Parecer nutricional criam o rascunho no 2º clique |
| CS-261 | **Nenhuma** divergência entre o que "No app do paciente" diz e o que a sessão de paciente enxerga | Teste de paridade (RNF-263 b) num cenário com conteúdo por etiqueta, receita do plano fora da audiência, documento cancelado, plano arquivado, envio cancelado, peso oculto e paciente arquivado |
| CS-262 | **Zero** ocorrência de CPF, endereço, telefone fixo ou observação na lista, em URL, em log, em mensagem de erro, no `audit_log` e no que vai à IA | Testes das chaves (RNF-263 c), do log (RNF-262) e `campos-enviados.test.ts` |
| CS-263 | Abrir o Início fica dentro da meta das páginas do painel (**p95 ≤ 800 ms**, RNF-01 v1.11) com as seções do registro | Pilha de carga (P08-03), cenário novo "abrir a ficha" |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| P-1 | Só documentos nesta etapa; código, migrations e testes vêm no plano | Fluxo de specs da onda |
| P-2 | **Sem custo novo e sem serviço externo**: nada de busca de CEP (ViaCEP etc.), que mandaria dado do paciente a terceiro | Memória "No extra costs"; LGPD art. 6º, III |
| P-3 | O painel segue o **visual V2** e o padrão de página (não modal) | Plano 08 |
| P-4 | **Somente adultos** (RN-17): não há responsável legal no cadastro | MVP D-11 |
| P-5 | **Abas em cima continuam** (pergunta 4); menu lateral agrupado fica no backlog | Dono, 16/11/2026 |
| P-6 | Os Planos 19, 20 e 23 **penduram seções** no registro do Início. O Plano 20 pendura a seção "Financeiro" (spec dele, F-D18 acertada, US-308, RN-329), com leitura auditada pelo ponto de extensão `leitura` do contrato (RN-277), não pela seção. A linha "Lembretes" do Plano 17 no "No app" é feita pelo próprio Plano 18 (o 17 entra antes) | Crítica da proposta, item 19; revisões de 16 e 17/11 |
| P-7 | Uma migration por vez na fila de merge; a do Plano 18 é **gerada de novo** em cima da `main` do momento (`sessoes-paralelas.md`, §5) | PD-01 |

---

## 2. Decisões (D1 a D22)

As decisões D2, D3, D4, D12, D16 e D10 são as respostas do dono às perguntas 1 a 6 da proposta (16/11/2026). As
demais são de desenho, tomadas aqui com o porquê, e incorporam as correções da crítica de completude conferidas no
código.

| ID | Decisão | Porquê |
|---|---|---|
| **D1** | Os campos novos ficam numa **tabela filha 1:1, `patient_cadastro`**, e não em colunas de `patients` | (a) `patients` está em `PUBLICO_LIBERADO` (select e insert, `rls-guard.ts:141`) e é lida com `select()` da linha inteira no contexto `publico` (`agendamento-publico.ts:209`) e no de paciente sem conta (`convite-paciente.ts:151`). Com a tabela filha, o banco nega CPF, endereço e observação ao contexto público (`publico_negado` nasce com `app_enable_tenant_rls`) e, por uma política RESTRICTIVE própria (`patient_cadastro_paciente_com_conta`, §9.1), a **todo** contexto de paciente sem sessão de login (`semConta`: convite, link da consulta, link do documento, link da autorização de IA, webhook do WhatsApp, contexto da IA Nutri e o "No app"). Sem essa política, `app_enable_patient_rls` deixaria esses contextos lerem a linha do titular (ela só compara `patient_id`); a proteção dependeria de cada leitura ter projeção. É o mesmo motivo que tirou o CPF de `tenants` para `tenant_signer` (spec de documentos, RN-145). (b) Resumo, rascunho e leitura da IA leem `patients` inteira (`resumo.ts:121`, `rascunho-ia.ts:121`, `leitura-job.ts:98`); com a tabela filha, um campo novo nunca vai à IA por acidente. (c) Não toca em `patients` nem no gatilho `paciente_colunas`, que o Plano 17 refaz na `0119` (coluna `lembretes_pausados_em`): some o conflito mais difícil da onda. Custo aceito: migration de RLS, auditoria e entradas nas guardas (§9). **Troca a recomendação aprovada** da proposta (colunas em `patients`): §15.2 |
| **D2** | Campos: os do pedido (CPF, estado civil, ocupação, telefone fixo, endereço, observação) **mais nome social, identidade de gênero, nacionalidade, naturalidade e escolaridade**, todos opcionais; **sem etnia** | Pergunta 1. A Res. CFN 594/2017, art. 4º, § 1º, I diz que o nutricionista "deverá" registrar esses dados; opcionais, não travam o agendamento público. Etnia é dado sensível (LGPD, art. 5º, II) e espera o CRN-3 e o advogado |
| **D3** | A **Observação** faz parte do cadastro e **vai na cópia do titular**; junto do campo, o aviso de que o paciente pode receber cópia; anotação só da equipe continua nas notas privadas do atendimento | Pergunta 2. Segue o direito de acesso (LGPD, art. 18, II) sem nova consulta ao advogado. Como vai na cópia, cabe na tabela filha legível pelo próprio titular (não precisa de `staff_only`) |
| **D4** | **CPF opcional, com dígito verificador, único por consultório**; aparece só no formulário do Perfil; nunca na lista, em URL, em log, em mensagem ou no `audit_log`; **sem busca por CPF** | Pergunta 3. A Res. CFN 594/2017, art. 4º, § 1º, I não pede CPF (conferida em 16/11/2026, §17); LGPD, art. 6º, III. Antes do CPF entrar no banco, a aplicação confere a repetição (D23), para o valor não ir ao log do Postgres. A busca por GET poria o CPF na URL e no histórico do navegador. O gatilho de auditoria grava só id, titular, ator e IP (`0007`), sem o conteúdo da linha |
| **D5** | **E-mail continua obrigatório**; nascimento e sexo continuam obrigatórios salvo no agendamento público (CHECK `patients_nascimento_e_sexo`) | É o login do app e a chave única no consultório; o Termo 1.0 promete a cópia e o aviso de incidente por e-mail. Torná-lo opcional pediria versão nova do termo |
| **D6** | O telefone de hoje passa a se chamar **"Celular / WhatsApp"**, **sem recusar fixo** e **sem mover dados**; o fixo ganha campo próprio | `normalizarTelefone` aceita fixo (8 dígitos começando com 2–5) e há cadastros com fixo em `telefone_e164`. Recusar quebraria a edição desses cadastros; mover seria migration de dados no banco de produção (regra 3 do servidor). A dica do campo orienta |
| **D7** | **Nome social só no painel**: cabeçalho da ficha, lista e busca; e entra na **máscara da IA**. Portal, e-mails, agenda, convites e documentos assinados continuam com o nome de registro (backlog). **Ordem:** na **impressão** (e no `prontuario.pdf` da exportação), o nome civil vem primeiro e "Nome social: {nome social}" logo depois (Res. CFN 594/2017, art. 4º, § 1º, I: "a seguir ao nome constante da identificação civil"); na **tela**, o cabeçalho abre pelo nome social com "Nome de registro: {nome}" abaixo, até a resposta do CRN-3 (§14); a **lista** mostra só o nome social (o nome de registro fica na ficha e no Perfil, que são leituras auditadas) | Limita a mudança a poucos pontos testáveis. Documento assinado copia o nome (RN-154) e precisa do nome de registro; o uso no app e nos e-mails pede revisão de textos e do termo e fica para um item próprio. A máscara precisa dele: se a nutricionista escrever o nome social num texto livre, ele não pode sair para a IA |
| **D8** | Cadastro em **página** (aba Perfil e "Novo paciente"), dividido em seções; **não** modal | Funciona melhor no celular e com leitor de tela; é o padrão do painel. Copiamos a função (dados agrupados), não o layout |
| **D9** | Lista com abas **Ativos** (padrão), **Inativos** (= arquivados) e **Todos** (ativos + arquivados); **Bloqueados** num filtro à parte, com o selo; ordenação e coluna **Desde** | O bloqueio é a suspensão do tratamento (LGPD, art. 5º, XIII) e não se mistura ao dia a dia (US-018) |
| **D10** | Menu por linha: Abrir ficha, Editar cadastro, Arquivar/Reativar (com confirmação) e **"Pedir exclusão (LGPD)"**, que leva ao pedido de exclusão da aba Privacidade; **nada é apagado** | Pergunta 6. O prontuário é guardado por 20 anos (Res. 594, art. 3º, VI, "b"). O rótulo "Excluir" enganaria: o fluxo existente bloqueia e anonimiza no prazo e exige digitar o nome (`MSG_LGPD.confirmarNome`) |
| **D11** | Local de atendimento: **nada** na tela nem no banco agora; `listarPacientes` só ganha o ponto de extensão (o filtro já é objeto) | Os locais nascem no Plano 23 (PD-70); coluna reservada agora seria palpite |
| **D12** | Ficha com **abas em cima**: "Resumo" vira **"Início"**, o cadastro vai para a aba nova **"Perfil"** (logo depois de Início). O rótulo visível da última aba passa a **"Histórico"** já no PR 1, com `aria-label="Histórico de acessos"` no link (o título da página continua "Histórico de acessos") | Pergunta 4. A faixa mede 1213 de 1232 px com 12 abas (`abas.tsx`, comentário); "Perfil" soma cerca de 46 px e "Início" no lugar de "Resumo" tira poucos, então a 13ª corta a última com certeza ("incomplete" no axe). "Histórico" sozinho seria ambíguo ao lado de Atendimentos e Evolução; o nome acessível completo começa pelo texto visível (WCAG 2.5.3) e mantém o seletor de `e2e/pacientes.spec.ts:95`. Uma 14ª aba não cabe nem assim (R-266) |
| **D13** | O **cabeçalho** mostra altura, peso, IMC e % de gordura da **última antropometria, com a data**, lidos **uma vez por requisição** (`cache()` do React, ao lado de `carregarProntuario`) com **um** `auditRead` (entidade `antropometria`); a linha de medidas **não sai na impressão**; com "Não mostrar peso no app" ligado, o selo "Peso oculto no app" | Regra 8 (dado de saúde). O layout não roda de novo entre abas irmãs, mas roda no carregamento completo e a cada `revalidatePath(…, 'layout')` das actions (ex.: `antropometria/actions.ts`): uma linha "Visualizou" por execução, aceita. Fora da impressão porque a folha impressa pode ir para a mão do paciente com o peso oculto (RN-203) |
| **D14** | **Registro de seções** em `src/modules/ficha/secoes/` (um arquivo por seção + `index.ts`); cada seção devolve **contador e últimos 3 itens só com rótulo genérico, data e situação**, e o **arquivo** da seção **nunca** chama `auditRead`. Uma seção que devolve dado auditado (o Financeiro do Plano 20) declara `leitura: { entidade }`, e `inicio.ts` grava **um** `auditRead` dessa entidade na mesma transação, só quando a seção devolve itens (revisão de 17/11: mudança de contrato feita no PR 1, antes do Plano 20 usar; RN-277) | Fundação: os outros planos acrescentam um arquivo e uma linha, sem disputar a página. Sem conteúdo clínico, segue o precedente da agenda, da lista de pacientes e das listas de documentos (P05 D10, 10A D17). Nome do modelo de anamnese ou do exame é dado de saúde ("Anamnese gestante", "Glicemia"): não aparece |
| **D15** | **Botão "Adicionar" único** no Início, alimentado pelo mesmo registro, em dois grupos (Avaliações, Prescrições) | Um caminho só para criar qualquer registro; tipos que não existem no código não aparecem |
| **D16** | "No app do paciente" = **cartão no Início + página `[id]/app`**; a contagem roda no **contexto de paciente sem ator** (`semConta`), só com contagens, depois de conferido o acesso da nutricionista | Pergunta 5. A sessão `nutri` enxerga tudo e diria "está no app" quando não está (exatidão, LGPD, art. 6º, V). A audiência de conteúdo é aplicada por política RESTRICTIVE (`paciente_conteudo_visivel`, 0083) e por `app_conteudo_por_etiqueta`, não por filtro em TypeScript: contar no contexto de paciente faz o **banco** aplicar as mesmas regras. Precedente: `convite-paciente.ts:151` já lê pelo `withTenant({ role: 'paciente', patientId, semConta: true })`. Duas exceções, onde o portal liga algo que a contagem não pode ligar: as **receitas sugeridas no plano** são contadas no contexto `nutri` (D24), e os filtros em TypeScript e os limites das funções do portal são repetidos em cada `noApp` (RN-281). O selo "No app" de cada item também é decidido no contexto de paciente (RN-279), nunca reproduzido à mão na sessão `nutri`. **Troca a recomendação aprovada** da proposta (filtros exportados dos módulos do portal): §15.2 |
| **D17** | O aviso **"Cadastro incompleto"** considera uma **lista fechada** de campos (RN-269) | Sem lista, o aviso ficaria permanente (etnia e responsável legal estão fora) |
| **D18** | LGPD: os campos novos vão no `dados.json` dos **dois escopos** (titular e equipe); na **anonimização a linha de `patient_cadastro` é apagada** (só o `worker`, com o titular já anonimizado); no **bloqueio** nada muda (fica identificado, como o resto do prontuário) | Termo 1.0 e DPA (cláusula 5) prometem anonimizar "o cadastro"; estado civil, ocupação e CEP ajudam a reidentificar (LGPD, arts. 5º, XI e 12). Apagar o CPF já no bloqueio é pergunta aberta ao advogado (§14) |
| **D19** | **IA**: `patient_cadastro` nunca vai à IA; só `nome_social` é lido pela IA, **só para a máscara** (`outrosNomes` de `AlvoDaMascara`) e sempre por projeção (`{ nomeSocial: patientCadastro.nomeSocial }`). No contexto da IA Nutri ele é lido no contexto `worker` (a política da D1 nega a tabela ao contexto de paciente sem conta em que o contexto é montado) | Mandar qualquer campo novo mudaria "o que é enviado" (RN-109: versão nova da autorização). CPF e telefone já saem pelos padrões genéricos `CPF` e `TELEFONE` de `mascarar`, sem ler o valor |
| **D20** | A lista e o Início nunca leem CPF, endereço, telefone fixo, observação nem os demais campos novos, salvo `nome_social` (lista) e a **presença** dos campos do aviso (Início) | Minimização (LGPD, art. 6º, III); a aba Perfil é o único lugar que lê os valores |
| **D21** | Entrega em **dois PRs**: (1) **fundação, sem migration** — abas Início/Perfil, cabeçalho, registro de seções e botão Adicionar; (2) cadastro (migration), lista e "No app" | `sessoes-paralelas.md`, §7: fundação primeiro, num PR pequeno, para as outras sessões fazerem rebase em cima. Sem migration, o PR 1 não espera a fila de migrations |
| **D22** | A migration **não tem número prometido**: é gerada de novo em cima da `main` no rebase (esperado depois da `0118` a `0120` do Plano 17) | `sessoes-paralelas.md`, §5: duas migrations geradas da mesma `main` têm o mesmo número e uma pode ser pulada em silêncio pelo migrador |
| **D23** | **CPF repetido conferido antes de gravar**, na transação, sob trava por consultório e CPF (`pg_advisory_xact_lock`); o índice único fica como última defesa. Toda validação dos CHECKs de `patient_cadastro` também roda no servidor antes do INSERT/UPDATE | O Postgres registra todo 23505 com `DETAIL: Key (tenant_id, cpf)=(…, 52998224725) already exists.` e todo 23514 com `Failing row contains (…)` (a linha inteira, com endereço e observação). A aplicação limpa o erro (`sanitizarErroDeBanco`), mas o log do container `nutri_db` ficaria com o CPF a cada tentativa, que é o caminho normal da US-260, não só a corrida. A trava serializa dois cadastros com o mesmo CPF, e o segundo acha o primeiro já gravado |
| **D24** | **Receitas sugeridas no plano** contadas no contexto `nutri`: refeições (`meals.recipe_content_id`) do plano `publicado` cujo conteúdo está `publicado`, a mesma regra do `disponivel` de `carregar.ts:40` | No portal, a receita fora da audiência só aparece porque `planoDoPaciente` liga `liberarReceitasDoPlano` (US-054). A contagem não pode ligar a liberação (a guarda de `conteudos.test.ts` aceita só os chamadores atuais, e o `set_config` local liberaria as outras contagens da mesma transação). Sem a liberação, a receita sumiria da contagem e o "No app" diria "0 receitas" com o cartão visível no app |
| **D25** | **Destinos do Adicionar** por link ou por ação: `adicionar.destino` é `{ href }` (abre a aba, com foco no título do formulário) ou `{ acao }` (chave de uma Server Action que a página Início liga: criar receita, criar parecer nutricional) | `anamnese/nova` chama `notFound()` sem `?modelo=` (a aba Anamnese escolhe o modelo num formulário GET); Receita e Parecer nutricional não são rotas, são Server Actions que criam o rascunho e redirecionam (`documentos/page.tsx`). Um `href` só não expressa isso |
| **D26** | **Arquivar e reativar pela lista** com `ConfirmarBotao` (o `window.confirm` do painel, botões do navegador) e o resultado numa região `role="status"` **fixa** acima da tabela, com o texto vindo do servidor (`?ok=arquivado`/`?ok=reativado` no redirect); o foco vai ao título da lista | A linha some da aba Ativos com o `revalidatePath`; uma mensagem morando na linha ou no menu seria desmontada sem ser anunciada, e o foco cairia no `<body>`. Reaproveita o padrão de confirmação existente em vez de um `<dialog>` novo |

---

## 3. Escopo

### 3.1 Dentro

| ID | Bloco | Conteúdo |
|---|---|---|
| PD-10 | Cadastro ampliado | Tabela `patient_cadastro` (D1); formulário em seções (Dados gerais; Contato e endereço; Observação; Acesso ao app) no Perfil e em "Novo paciente"; CPF com dígito verificador e único (D4); rótulo "Celular / WhatsApp" (D6); nome social no painel e na máscara da IA (D7); aviso "Cadastro incompleto" (D17); exportação e anonimização (D18) |
| PD-11 | Lista | Abas Ativos/Inativos/Todos e filtro Bloqueados; ordenação; coluna "Desde"; menu por linha; ponto de extensão do local (D11) |
| PD-12 | Ficha Início | Abas Início e Perfil (D12); cabeçalho com a última antropometria (D13); cartão Resumo; registro de seções com 8 seções (D14); botão Adicionar (D15) |
| PD-13 | No app do paciente | Cartão no Início e página `[id]/app` com contagens pelo contexto de paciente (D16) |
| — | Fechamento | Manual guiado (`data-guia`, guias novos do Início e do Perfil, versões de `pacientes` e `prontuario` subindo), axe, manual técnico (§2.5.4, §4.2, cap. 05 §5.8.1 — a lista dos guias —, README), manual do usuário (Docs), Central de Ajuda, CLAUDE.md (regras 1, 2 e 8) e `SEM_CONTA_PERMITIDOS` (com os comentários de `semConta`) |

### 3.2 Fora

- **Local de atendimento** (tabela, coluna, filtro): Plano 23 (PD-70).
- **Lembretes de água e refeição**: Plano 17; entram no "No app" como seção registrada quando o Plano 17 estiver na `main`.
- Questionário pré-consulta, recordatório alimentar, metas, avaliação tipo "DB360", videochamada, chat e envio de
  e-mail pela ficha: não existem; cada plano futuro pendura a sua seção no registro.
- Do Dietbox, também fora: as subseções "Resumo" e "Opinião" do perfil, e "Materiais" e "Listas de substituição" do
  menu Outros (listas de substituição são escopo do Plano 19).
- Menu lateral agrupado no lugar das abas (backlog, P-5).
- Formulário em modal; busca de CEP em serviço externo (P-2).
- Busca por CPF; paginação da lista (o limite de 500 continua); filtro por mais de uma etiqueta.
- E-mail opcional (D5); responsável legal (P-4); etnia (D2).
- Nome social no portal, nos e-mails, na agenda, nos convites e nos documentos (D7, backlog).
- Apagar de verdade cadastro criado por engano (depende do CRN-3 e do advogado, §14).
- Gráficos e comparativos no Início (continuam nas abas Evolução e Exames); exportar ou enviar o plano pela ficha.
- Seção "Financeiro" (Plano 20, PD-33): o Plano 18 só deixa o registro pronto, com os pontos de extensão de que ela precisa (RN-277, R-266).

---

## 4. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Ler e gravar o cadastro completo de paciente `ativo` ou `arquivado`; consultar o de `bloqueado`; arquivar e reativar pela lista; abrir o pedido de exclusão; ver o "No app" | Gravar cadastro de paciente bloqueado ou anonimizado (`carregarPacienteParaEscrita`); apagar a linha de `patient_cadastro` (gatilho, RN-283) |
| **Paciente** (sessão `paciente` com login) | Nada novo na tela. A RLS deixa o titular **com sessão de login** ler a própria linha de `patient_cadastro` (é dado dele, D3), mas o portal não a lê na v1 | Gravar `patient_cadastro` (`app_enable_tenant_rls` nega INSERT/UPDATE/DELETE à sessão de paciente; a tabela **não** entra em `PACIENTE_ESCREVE`) |
| **Paciente sem login** (`semConta`: convite, links assinados, webhook do WhatsApp, contexto da IA Nutri, "No app") | — | Ler ou gravar `patient_cadastro` (política RESTRICTIVE `patient_cadastro_paciente_com_conta`, D1) |
| **Público** (agendamento) | — | Ler ou gravar `patient_cadastro` (`publico_negado`; a tabela **não** entra em `PUBLICO_LIBERADO`). O paciente criado pela página pública nasce sem linha |
| **Worker** | Ler para a exportação; apagar a linha na anonimização (e na rede da varredura diária, RN-283); ler **só `nome_social`** para a máscara da IA | Ler outros campos para a IA (guarda, RN-282) |
| **Admin** | — (nada novo) | Ver dado de paciente (como hoje) |

---

## 5. Histórias de usuário e critérios de aceite

### US-260 — Cadastro completo do paciente (PD-10; emenda à US-010) · **M**

**Como** nutricionista, **quero** registrar os dados de identificação que a norma pede, **para** ter o cadastro
completo da primeira consulta sem travar quem chega pela página pública.

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| `nome` ("Nome completo") | texto | Sim | 2–120 (como hoje) | "Informe o nome" |
| `nome_social` | texto | Não | 2–120 | "Use entre 2 e 120 caracteres" |
| `data_nascimento`, `sexo`, `email` | — | como hoje | como hoje (US-010) | como hoje |
| `identidade_genero` | lista | Não | `mulher`, `homem`, `nao_binario`, `outra`, `prefere_nao_informar` | "Escolha uma opção da lista" |
| `estado_civil` | lista | Não | `solteiro`, `casado`, `uniao_estavel`, `separado`, `divorciado`, `viuvo` | "Escolha uma opção da lista" |
| `escolaridade` | lista | Não | `sem_escolaridade`, `fundamental_incompleto`, `fundamental_completo`, `medio_incompleto`, `medio_completo`, `superior_incompleto`, `superior_completo`, `pos_graduacao` | "Escolha uma opção da lista" |
| `ocupacao` | texto | Não | 2–80 | "Use entre 2 e 80 caracteres" |
| `nacionalidade` | texto | Não | 2–60 | "Use entre 2 e 60 caracteres" |
| `naturalidade` | texto | Não | 2–80 | "Use entre 2 e 80 caracteres" |
| `cpf` | texto | Não | 11 dígitos depois de tirar pontos e traço; dígitos verificadores; não todos iguais; único no consultório | "CPF inválido. Confira os números." / "Já existe um paciente com este CPF neste consultório." |
| `telefone` ("Celular / WhatsApp") | texto | Não | como hoje (E.164; aceita fixo, D6) | "Telefone inválido" |
| `telefone_fixo` | texto | Não | `normalizarTelefone` | "Telefone fixo inválido" |
| `cep` | texto | Não | 8 dígitos depois de tirar o traço | "CEP inválido. Use os 8 números." |
| `logradouro` / `numero` / `complemento` / `bairro` / `cidade` | texto | Não | 2–120 / 1–10 / 1–60 / 2–60 / 2–60 | "Use entre {min} e {max} caracteres" (ex.: "Use entre 2 e 60 caracteres") |
| `uf` | lista | Não | uma das 27 UFs | "Selecione um estado da lista" |
| `observacao` | texto | Não | 1–1.000 (com espaços nas pontas tirados) | "Use no máximo 1.000 caracteres" |

```gherkin
Cenário: Cadastro com os campos novos
  Dado que estou em "Novo paciente"
  Quando preencho os campos obrigatórios, o CPF "529.982.247-25", o estado civil "Casado(a)" e o CEP "13015-904"
  E salvo
  Então o paciente é criado e o convite sai como hoje (US-010)
  E a linha de patient_cadastro é gravada na mesma transação, com cpf "52998224725" e cep "13015904"

Cenário: Nenhum campo novo preenchido
  Quando cadastro só os campos obrigatórios
  Então nenhuma linha de patient_cadastro é criada
  E a aba Perfil mostra os campos vazios

Cenário: CPF inválido (a mensagem nunca repete o número)
  Quando informo o CPF "111.111.111-11" e salvo
  Então vejo "CPF inválido. Confira os números." junto do campo
  E o texto da página, o log e o Sentry não contêm "11111111111"

Cenário: CPF repetido no consultório
  Dado que o paciente "Ana Souza" já tem o CPF "529.982.247-25"
  Quando cadastro outro paciente com o mesmo CPF
  Então vejo "Já existe um paciente com este CPF neste consultório." e o link "Abrir o cadastro existente (abre em nova aba)"
  E o que digitei continua no formulário
  E nada é gravado, e o log do Postgres não registra o CPF (a repetição é conferida antes do INSERT, D23)
  # vale também se o outro estiver arquivado; depois da anonimização o CPF não existe mais

Cenário: CPF repetido de paciente bloqueado
  Dado que o paciente com o CPF "529.982.247-25" está bloqueado por pedido de exclusão
  Quando cadastro outro paciente com o mesmo CPF
  Então vejo "Já existe um paciente com este CPF neste consultório." sem o link
  # comportamento provisório até a resposta do advogado (§14): a unicidade continua, como a do e-mail

Cenário: Paciente do agendamento público
  Dado um paciente criado pela página pública (sem nascimento e sem sexo)
  Então ele não tem linha em patient_cadastro e o selo "Completar cadastro" continua como hoje

Cenário: Paciente bloqueado
  Dado um paciente bloqueado por pedido de exclusão
  Quando abro a aba Perfil
  Então vejo todos os campos só para leitura e "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."

Cenário: Observação com aviso
  Quando abro a seção "Observação"
  Então vejo junto do campo "O paciente pode receber uma cópia deste campo se pedir os dados dele (LGPD). Para anotações só suas, use as notas privadas do atendimento."

Cenário: Pedido de exclusão de paciente com nome social
  Dado o paciente de nome "João Silva" com nome social "Joana Silva"
  Quando abro "Pedido de exclusão (LGPD, art. 18)" na aba Privacidade
  Então a instrução diz "Digite o nome de registro do paciente (João Silva) exatamente como está no cadastro para confirmar."
```

### US-261 — Lista de pacientes com abas, ordem e ações (PD-11) · **M**

**Como** nutricionista, **quero** separar ativos e inativos, ordenar e agir sem abrir a ficha, **para** cuidar da
lista no dia a dia.

```gherkin
Cenário: Abas
  Quando abro "Pacientes"
  Então vejo as abas "Ativos", "Inativos" e "Todos", com "Ativos" marcada (aria-current="page")
  E a coluna "Desde" com a data de cadastro (dd/mm/aaaa, fuso do consultório)
  E o link "Ver bloqueados" fora das abas

Cenário: Todos não mostra bloqueados
  Dado um paciente ativo, um arquivado e um bloqueado
  Quando abro a aba "Todos"
  Então vejo o ativo e o arquivado (com o selo "Arquivado") e não vejo o bloqueado

Cenário: Ordenação
  Quando escolho "Mais recentes" em "Ordenar por"
  Então a lista vem do cadastro mais novo para o mais antigo
  E a URL leva "ordem=recentes", e a aba e a busca continuam aplicadas (o formulário leva a aba e a situação em campos ocultos)

Cenário: Link antigo
  Quando abro "/painel/pacientes?status=arquivado"
  Então vejo a aba "Inativos" marcada

Cenário: Nome social na lista e na busca
  Dado o paciente de nome "João Silva" com nome social "Joana Silva"
  Então a linha mostra só "Joana Silva" (o nome de registro fica na ficha e no Perfil)
  E buscar "Joana" ou "João" acha o paciente

Cenário: Arquivar pela lista
  Dado um paciente ativo com convite pendente
  Quando abro "Ações de Ana Souza" e escolho "Arquivar"
  Então o navegador pede a confirmação "Arquivar Ana Souza? O paciente perde o acesso ao app e deixa de receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar quando quiser."
  Quando confirmo
  Então a região de aviso acima da tabela anuncia "Paciente arquivado.", o foco vai ao título "Pacientes"
  E o convite pendente foi apagado (arquivarPaciente)

Cenário: Paciente arquivado na lista
  Dado um paciente arquivado que já tinha criado a senha
  Quando abro a aba "Inativos"
  Então a coluna "Acesso ao app" diz "Sem acesso (arquivado)"

Cenário: Pedir exclusão leva à Privacidade
  Quando escolho "Pedir exclusão (LGPD)"
  Então abro a aba Privacidade da ficha na seção "Pedido de exclusão (LGPD, art. 18)"
  E nada é alterado no paciente até eu concluir o pedido lá

Cenário: Paciente bloqueado
  Quando abro "Ver bloqueados"
  Então cada linha tem só "Abrir ficha" no menu de ações
```

### US-262 — Ficha "Início" (PD-12) · **M**

**Como** nutricionista, **quero** ver num lugar só quem é o paciente, as medidas atuais e o que já foi feito,
**para** começar a consulta sem abrir aba por aba.

```gherkin
Cenário: Cabeçalho com a última avaliação
  Dado que a última antropometria de Ana é de 12/10/2026, com 1,65 m, 72,4 kg, IMC 26,6 e 28,1% de gordura
  Quando abro qualquer aba da ficha
  Então o cabeçalho mostra "Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura 28,1%"
  E o audit_log tem uma linha "ler" de "antropometria" por carregamento da ficha (não uma por aba aberta na mesma requisição)

Cenário: Sem avaliação
  Então o cabeçalho mostra "Sem avaliação antropométrica."

Cenário: Impressão
  Quando imprimo uma aba da ficha
  Então a linha de medidas não sai na folha
  E, com nome social, a folha traz o nome civil primeiro e "Nome social: Joana Silva" logo depois (Res. CFN 594/2017, art. 4º, § 1º, I)

Cenário: Nome social no cabeçalho (tela)
  Dado o paciente de nome "João Silva" com nome social "Joana Silva"
  Então o título do cabeçalho é "Joana Silva" e, abaixo, "Nome de registro: João Silva"

Cenário: Abas
  Então a primeira aba se chama "Início" e a segunda "Perfil", e a última mostra "Histórico" (nome acessível "Histórico de acessos")
  E o formulário de cadastro, o "Acesso ao app" (com "Reenviar convite") e as "Etiquetas" ficam no Perfil
  E o botão do resumo da IA (US-120) fica no Início

Cenário: Seções com contador
  Dado 3 anamneses, 5 avaliações e um plano publicado
  Então vejo as seções "Anamneses (3)", "Antropometria (5)" e "Plano alimentar (1)"
  E cada seção mostra até 3 itens com rótulo genérico, data e situação, e o link "Ver todos"
  E nenhum item mostra o nome do modelo da anamnese nem o nome do exame
  E abrir o Início não grava "ler" no audit_log para as seções

Cenário: Selo "No app"
  Dado que o paciente está ativo e já entrou no app
  Então o plano publicado, as avaliações, os atendimentos, os documentos emitidos e os envios de exame levam o selo "No app"
  E anamneses, exames registrados pela nutricionista e cálculos de gasto energético não levam
  Dado que o paciente está arquivado
  Então nenhum item leva o selo

Cenário: Cadastro incompleto
  Dado que faltam estado civil e endereço
  Então o cartão Resumo mostra a nota "Cadastro incompleto: faltam estado civil e endereço." e o link "Completar no Perfil"
  Dado que faltam 6 itens
  Então a nota diz "Cadastro incompleto: faltam 6 dados." e o link "Completar no Perfil"
```

### US-263 — Botão "Adicionar" (PD-12) · **M**

```gherkin
Cenário: Um botão para criar qualquer registro
  Quando toco em "Adicionar" no Início
  Então abre o diálogo "Adicionar ao prontuário" com os grupos "Avaliações" (Anamnese, Antropometria, Gasto energético, Exame, Atendimento) e "Prescrições" (Plano alimentar, Receita, Parecer nutricional)
  E a dica "Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético."
  Quando escolho "Antropometria"
  Então abro a aba Antropometria com o foco no título "Nova avaliação"
  Quando escolho "Anamnese"
  Então abro a aba Anamnese com o foco no seletor de modelo (nunca a página "anamnese/nova" sem modelo)
  Quando escolho "Receita"
  Então o rascunho da receita é criado, como no botão "Nova receita" da aba Documentos

Cenário: Documentos desligados
  Dado que o consultório não tem os documentos assinados liberados
  Então "Receita" e "Parecer nutricional" não aparecem

Cenário: Paciente bloqueado ou arquivado
  Dado um paciente bloqueado
  Então o botão "Adicionar" não aparece
  # arquivado: aparece, como hoje cada aba deixa registrar
```

### US-264 — "No app do paciente" (PD-13) · **M**

```gherkin
Cenário: Cartão no Início
  Dado que Ana já entrou no app e tem plano publicado, 2 documentos emitidos e 12 conteúdos na biblioteca
  Então o cartão "No app do paciente" mostra "Acesso: ativo · último acesso em 14/11/2026", "Plano alimentar publicado", "2 documentos" e "12 conteúdos"
  E o link "Ver detalhes" abre /painel/pacientes/{id}/app

Cenário: Conteúdo por etiqueta conta só o que o paciente vê
  Dado um conteúdo publicado só para a etiqueta "gestante" e Ana sem essa etiqueta
  Então esse conteúdo não entra na contagem de "conteúdos na biblioteca" de Ana

Cenário: Receita do plano fora da audiência
  Dado que o plano publicado de Ana sugere uma receita publicada só para a etiqueta "gestante", e Ana não tem a etiqueta
  Então a página diz "1 receita sugerida", como o cartão que Ana vê no plano (US-054)

Cenário: Peso oculto
  Dado "Não mostrar peso no app" ligado para Ana
  Então a página diz "Peso e IMC: ocultos no app (Não mostrar peso no app)."

Cenário: Paciente sem acesso
  Dado um paciente com convite pendente
  Então o cartão diz "Ainda não entrou no app. Convite enviado por e-mail. Vale até {data e hora}." e não mostra contagens
  Dado um paciente arquivado
  Então o cartão diz "Paciente arquivado: não vê nada no app até ser reativado."

Cenário: Sem trilha de leitura
  Quando abro a página "No app do paciente"
  Então nenhum "ler" é gravado no audit_log (só contagens), e nenhum conteúdo clínico é lido
```

---

## 6. Regras de negócio

| ID | Regra |
|---|---|
| RN-260 | **Cadastro complementar.** Os campos da tabela da US-260, salvo nome, nascimento, sexo, e-mail e celular, ficam em `patient_cadastro` (uma linha por paciente, D1). A linha nasce no primeiro "Salvar" que tenha algum campo novo preenchido e é gravada **na mesma transação** de `patients` (`criarPaciente`/`atualizarPaciente`, por *upsert* em `(tenant_id, patient_id)`). Esvaziar todos os campos grava a linha com tudo nulo (não apaga: o DELETE é só da anonimização, RN-283). A página pública nunca cria a linha |
| RN-261 | **CPF.** Normalizado para 11 dígitos; o dígito verificador é conferido no servidor (`src/modules/pacientes/cpf.ts`: `normalizarCpf`, `cpfValido`, `formatarCpf`); CPF com 11 dígitos iguais é inválido. O banco confere o formato (CHECK) e a unicidade por consultório (índice único parcial). **Repetição conferida antes de gravar** (D23): na transação de `criarPaciente`/`atualizarPaciente`, `pg_advisory_xact_lock(hashtext('patient_cadastro_cpf'), hashtext(tenant_id || ':' || cpf))` e depois a procura de outro paciente com o mesmo CPF (contexto `nutri`, que vê todos os pacientes do consultório); achou → `PacienteError` com a mensagem da US-260 e o id do outro para o link "Abrir o cadastro existente" (sem o link se o outro está `bloqueado`, M-3 da revisão). O índice continua como última defesa (23505 → a mesma mensagem). Os CHECKs da tabela são todos conferidos antes no servidor (`pacienteSchema`), para nenhum 23514 levar a linha ao log do Postgres. Erros nunca repetem o valor digitado |
| RN-262 | **Onde o CPF aparece.** Só no formulário do Perfil (o campo de edição) e no `dados.json` da exportação (formatado `000.000.000-00`). Nunca na lista, no cabeçalho, no Início, no "No app", no `prontuario.pdf` da exportação, em URL (o formulário é POST por Server Action), em log (da aplicação e do Postgres, D23), no Sentry, em mensagem, e-mail, push ou WhatsApp. Sem busca por CPF |
| RN-263 | **Endereço.** CEP (8 dígitos, exibido `00000-000`), rua, número (aceita "s/n"), complemento, bairro, cidade e UF (lista fechada das 27). Só endereço no Brasil na v1. Nenhuma busca de CEP em serviço externo (P-2) |
| RN-264 | **Telefones.** "Celular / WhatsApp" é o `patients.telefone_e164` de hoje, com as regras de hoje (opt-in, convite por WhatsApp) e sem recusar fixo (D6). "Telefone fixo" é `patient_cadastro.telefone_fixo_e164`, normalizado por `normalizarTelefone`; nunca recebe WhatsApp nem aviso |
| RN-265 | **Observação.** Até 1.000 caracteres, com o aviso da US-260 junto do campo; vai na cópia do titular (D3); não vai à IA (RN-282); some na anonimização (RN-283) |
| RN-266 | **Nome social.** Preenchido só a pedido do paciente (dica do campo). No painel, onde houver nome social: na **tela**, o cabeçalho da ficha mostra o nome social como título e "Nome de registro: {nome}" abaixo (elementos com `print:hidden`); na **impressão**, o cabeçalho traz o nome civil e, logo depois, "Nome social: {nome social}" (elementos `hidden print:block`; Res. CFN 594/2017, art. 4º, § 1º, I); o `prontuario.pdf` da exportação segue a ordem da impressão; a lista mostra **só** o nome social; a busca casa nos dois; a ordem por nome usa `coalesce(nome_social, nome)`. Na aba Privacidade, com nome social, a instrução do pedido de exclusão pede o **nome de registro** e o mostra (`atenderPedidoExclusao` compara com `patients.nome`). Em todo o resto (portal, e-mails, agenda, convites, documentos assinados, PDF do plano, Histórico de acessos), o nome de registro, como hoje (D7) |
| RN-267 | **Quem grava.** Só a sessão `nutri`, por `withTenant` com `actorUserId` e `ip`, depois de `carregarPacienteParaEscrita` (bloqueado ou anonimizado → `PacienteBloqueadoError`, a tela fica só leitura). O gatilho de auditoria grava "criar"/"alterar" com a entidade `patients` ("Cadastro do paciente" no Histórico de acessos) |
| RN-268 | **Leitura do cadastro complementar.** Só a aba Perfil lê os valores, por `cadastroDoPaciente(ctx, patientId)`, com `auditRead` próprio (entidade `patients`) na mesma transação. `carregarProntuario` (todas as abas) traz **só** o `nome_social`: `buscarPaciente` (`src/modules/pacientes/pacientes.ts`) passa a fazer `left join` em `patient_cadastro` projetando apenas `nome_social`, coberto pelo `auditRead` de "Cadastro do paciente" que essa leitura já faz. CPF, endereço e observação nunca entram no objeto `paciente` que as abas passam a componentes cliente. Abrir o Perfil grava, portanto, duas leituras de "Cadastro do paciente" (a do layout e a do Perfil): aceito |
| RN-269 | **"Cadastro incompleto"** (D17). A nota aparece quando falta pelo menos um destes: data de nascimento, sexo, identidade de gênero, estado civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço (CEP, rua, número, bairro, cidade e UF; complemento não conta) e um telefone (celular **ou** fixo). Não contam: nome social (só a pedido), CPF (D4), observação, complemento. O Início lê só a **presença** de cada campo (`campo is not null`), nunca o valor — sem `auditRead`. Texto: com até 3 itens faltando, "Cadastro incompleto: faltam {itens}." (itens em minúsculas, separados por vírgula e "e"); com 4 ou mais, "Cadastro incompleto: faltam {n} dados."; nos dois casos o link "Completar no Perfil". Componente `Aviso` (`tipo="aviso"`, `papel="nenhum"`), sem glifo próprio: a nota vai aparecer em quase todo paciente antigo e não pode soar como erro |
| RN-270 | **Abas da lista.** `?aba=ativos` (padrão, `status = 'ativo'`), `inativos` (`arquivado`), `todos` (`status in ('ativo','arquivado')`); `?situacao=bloqueados` mostra só `bloqueado`, com o selo, sem as abas marcadas. O link antigo `?status=arquivado` vale como `aba=inativos` e `?status=bloqueado` como `situacao=bloqueados`; outro valor desconhecido cai no padrão. Busca, etiqueta e ordem combinam com qualquer aba: o formulário GET de filtro leva `aba` e `situacao` em `<input type="hidden">`, e os links das abas levam a busca, a etiqueta e a ordem. Limite de 500 linhas (`LIMITE_LISTA`), como hoje |
| RN-271 | **Ordem.** `?ordem=` `nome` (padrão, A–Z), `nome_desc` (Z–A), `recentes` (`created_at` desc), `antigos` (`created_at` asc); empate por `id`. O nome da ordem é o exibido (RN-266), com `unaccent` e sem diferença de maiúsculas |
| RN-272 | **Projeção da lista** (D20). `listarPacientes` seleciona só id, nome, `nome_social` (por `left join` em `patient_cadastro`), e-mail, status, nascimento, `user_id`, origem e `created_at`. A lista continua sem `auditRead`, **salvo** com filtro de etiqueta, que continua gravando uma leitura de "Etiquetas" por paciente devolvido (`pacientes.ts`, regra 8). Teste das chaves devolvidas |
| RN-273 | **Menu da linha.** Botão "Ações de {nome exibido}" (disclosure: `aria-expanded`, `aria-controls`). Fecha com Esc, com clique fora e depois de escolher um item; ao fechar, o foco volta ao botão; o painel do menu não pode ser cortado pelo contêiner com rolagem horizontal da tabela (posicionado fora do `overflow`, ou a tabela sem `overflow` no eixo vertical). Paciente ativo: Abrir ficha, Editar cadastro (→ Perfil), Arquivar, Pedir exclusão (LGPD). Arquivado: Abrir ficha, Editar cadastro, Reativar, Pedir exclusão (LGPD). Bloqueado: Abrir ficha. Arquivar e Reativar pedem confirmação por `ConfirmarBotao` (D26; textos na §8.1) e chamam `arquivarPaciente`/`desarquivarPaciente` (`lgpd.ts`), as mesmas da aba Privacidade, por actions da lista que redirecionam para a mesma URL com `ok=arquivado`/`ok=reativado`. "Pedir exclusão (LGPD)" é um link para `/painel/pacientes/{id}/privacidade#exclusao` e não grava nada |
| RN-274 | **Abas da ficha.** `ABAS` passa a: Início (`''`), Perfil (`perfil`), Antropometria, Gasto energético, Anamnese, Atendimentos, Exames, Evolução, Privacidade, Plano alimentar, Documentos (condicional), IA Nutri (condicional), Histórico (`historico`, `aria-label="Histórico de acessos"`, D12) — com a regra do comentário mantida ("Cada tarefa acrescenta a sua ANTES de 'historico'"). A aba Início fica marcada também em `[id]/app` e `[id]/resumo-ia` |
| RN-275 | **Cabeçalho** (D13). `carregarCabecalho = cache(async (patientId: string) => …)` (chave de cache **texto**, como `carregarProntuario`; o `ctx` vem de `carregarProntuario(patientId)` dentro da função) lê a última linha de `anthropometry` (`order by data desc, created_at desc limit 1`) e, se houver, grava **um** `auditRead` (entidade `antropometria`, `entidadeId` da avaliação). Formato: altura em metros com vírgula e duas casas; peso com uma casa; IMC com uma casa; gordura com uma casa e "%", omitida quando nula; data `dd/mm/aaaa`. A linha tem `print:hidden`. Com `peso_oculto_no_app_em`, o selo "Peso oculto no app" ao lado (o painel continua mostrando o peso: RN-204) |
| RN-276 | **Cartão Resumo** do Início: "Aniversário: {dia} de {mês}"; "Paciente desde {dd/mm/aaaa}" (`created_at` no fuso); "Plano alimentar publicado em {dd/mm/aaaa}" ou "Nenhum plano publicado"; a nota da RN-269. O acesso ao app aparece **só** no cartão "No app do paciente" (sem repetir aqui). Sem `auditRead` (nascimento e e-mail já foram lidos e auditados pelo `carregarProntuario`; o resto é contagem e data) |
| RN-277 | **Registro de seções** (D14). `src/modules/ficha/secoes/index.ts` exporta `SECOES_DA_FICHA`, uma lista ordenada; cada arquivo exporta uma `SecaoDaFicha`: `id`, `titulo`, `aba` (segmento da aba "Ver todos"), `disponivel(tenant, paciente, total)` (o `total` serve à RN-192 dos envios), `resumo(tx, patientId) → { total, ultimos: ItemDaSecao[], podeAdicionar? }` (no máximo 3, mais recentes primeiro; **nunca** chama `auditRead`; `podeAdicionar: false` esconde o `adicionar` da seção, ex.: Financeiro não configurado), `verTodos?(patientId)` ("Ver todos" fora da ficha, caminho absoluto em `/painel/`; sem ele, a `aba`), `leitura?: { entidade }` (seção que devolve dado auditado: `inicio.ts` grava **um** `auditRead` dessa entidade, na mesma transação, só quando a seção devolve itens; nenhuma das seções do Plano 18 tem), `adicionar?: lista de { grupo: 'avaliacoes' \| 'prescricoes' \| 'outros'; rotulo; destino: { href } \| { acao: ChaveDeAcao } }` (D25; lista porque Documentos tem Receita e Parecer nutricional; `href` relativo à ficha ou absoluto em `/painel/`; o grupo "Outros" só aparece no diálogo quando alguma seção o usa) e `noApp?: { contar(tx: TxDePaciente, patientId) → number; visiveis(tx: TxDePaciente, patientId, ids) → string[] }`. `TxDePaciente` é um tipo marcado (*branded*) que só `no-app.ts` cria, depois de conferir `current_setting('app.role') = 'paciente'` na transação; o helper que abre o contexto `semConta` **não** é exportado. `ItemDaSecao` tem **exatamente** as chaves `id`, `rotulo`, `data`, `situacao` (opcional), `noApp` (booleano) e `href` (relativo à ficha ou absoluto em `/painel/`: o envio do paciente abre em `/painel/exames-recebidos/{id}`, e o "Ver todos" da seção de envios é a aba Exames). Os links do Início para páginas que gravam `auditRead` usam `prefetch={false}`. Todas as seções do Início rodam numa transação (`withTenant` da sessão `nutri`). Teste: toda seção com `noApp` está no teste de paridade (RNF-263 b) |
| RN-278 | **Seções do Plano 18**, na ordem: Plano alimentar (rótulo "Plano alimentar", situação Rascunho/Publicado/Arquivado), Antropometria ("Avaliação"), Gasto energético ("Cálculo"), Anamneses ("Anamnese", sem o nome do modelo), Atendimentos ("Atendimento"), Exames ("Exame", sem o nome), Exames enviados pelo paciente ("Envio do paciente", com a situação do envio; só com o recebimento ligado ou algum envio, como a RN-192) e Documentos ("Receita"/"Parecer nutricional" — `TIPO_DOCUMENTO_ROTULO` —, com a situação; só com `documentosLiberados`). Seção vazia: "Nenhum registro ainda." O `<details>` de cada seção abre por padrão quando `total > 0` |
| RN-279 | **Selo "No app"** por item, só com o paciente `ativo`, não anonimizado e com `user_id` (o `estado: 'ativo'` de `situacaoDoAcesso` olha só o `user_id`; arquivado e bloqueado nunca têm selo). O selo é decidido **no contexto de paciente**: `noAppDoPaciente` recebe os ids dos itens mostrados no Início e devolve, por seção, os que `noApp.visiveis` acha na sessão de paciente (a mesma consulta da contagem, com os mesmos filtros), sem reproduzir as políticas na sessão `nutri`. Seções com `noApp`: plano (só `publicado`; a política `paciente_sem_rascunho` também mostra o arquivado, que o portal descarta em TypeScript), avaliações (com peso oculto, a seção diz "Peso e IMC ocultos no app"), atendimentos, documentos (`paciente_so_emitidos` e o filtro de `anonimizado_em` de `documentosDoPaciente`), envios de exame não cancelados. Anamneses, exames da nutricionista e gasto energético não têm `noApp`. O teste de paridade compara o selo item a item com o conjunto que a função do portal devolve (RNF-263 b) |
| RN-280 | **Adicionar** (D15, D25). Diálogo modal nativo (`<dialog>`), título "Adicionar ao prontuário", montado a partir das seções com `adicionar` e `disponivel`. Avaliações: Anamnese (`anamnese#modelo`: foco no seletor de modelo, o `<select id="modelo">` que já existe), Antropometria (`antropometria#nova-avaliacao`), Gasto energético (`gasto-energetico#novo-calculo`), Exame (`exames#novo-exame`), Atendimento (`atendimentos#novo-atendimento`). Prescrições: Plano alimentar (link para a aba Plano alimentar, que mostra "Criar plano" ou o rascunho em andamento), Receita e Parecer nutricional (`<form action>` no diálogo com as mesmas Server Actions dos botões da aba Documentos, `criarReceitaAction`/`criarParecerAction`; só com `documentosLiberados`). Destino por âncora: a página de destino põe o foco no título (`h2` com `tabIndex={-1}`) que a âncora aponta (componente cliente `FocoNaAncora`); a âncora só rola, não move o foco. Não aparece para paciente bloqueado ou anonimizado. Tipos sem tela no código não aparecem |
| RN-281 | **"No app do paciente"** (D16). `noAppDoPaciente(ctx, patientId, itens?)` (`src/modules/ficha/no-app.ts`) aceita só `ctx.role === 'nutri'` e tira o `tenantId` do `ctx`: (1) no contexto `nutri`, lê status, anonimização, situação do acesso (`situacaoDoAcesso`), último dia em `access_events`, inscrições de push, opt-in de WhatsApp, `peso_oculto_no_app_em`, participação na IA Nutri, `tenants.mostrar_perc_gordura_paciente`, a data de publicação do plano e se há lista de compras, os lembretes do Plano 17 (§8.5) e a contagem de **receitas sugeridas** no plano publicado (D24); (2) só se o paciente está `ativo`, não anonimizado e com acesso ativo, abre `withTenant({ tenantId, role: 'paciente', patientId, semConta: true })`, confere o papel e roda **apenas** `noApp.contar`/`noApp.visiveis` de cada seção: plano publicado, avaliações, atendimentos, documentos, conteúdos da biblioteca (a política RESTRICTIVE aplica a audiência; `liberarReceitasDoPlano` **não** é chamada), envios de exame, registros do diário nos últimos 30 dias. Cada `noApp` repete os filtros em TypeScript da função do portal correspondente (`status = 'publicado'` no plano, `anonimizado_em` nos documentos, envio não cancelado) e conta **sem** o limite da lista do portal (`FEED_LIMITE`, `meusEnvios` com `limit 50`): a página diz o total, o app mostra até o limite. Nenhuma coluna de conteúdo é selecionada; nenhum `auditRead`. O arquivo entra em `SEM_CONTA_PERMITIDOS` (`src/db/tenant.ts`), e os comentários de `semConta` e de `SEM_CONTA_PERMITIDOS` passam a citar "a contagem do No app, pela nutricionista, no contexto do paciente", com revisão do `revisor-rls` |
| RN-282 | **IA** (D19). Nenhum módulo de `src/modules/ia/` seleciona `patient_cadastro` a não ser pela projeção `{ nomeSocial: patientCadastro.nomeSocial }`; o `nome_social`, quando houver, entra em `outrosNomes` do `AlvoDaMascara` no resumo, no rascunho e no contexto da IA Nutri (a leitura de laudo envia o arquivo e não usa máscara: fica de fora). No contexto da IA Nutri, a leitura é no contexto `worker` (helper `nomeSocialParaMascara(db, tenantId, patientId)`), fora da transação `semConta`. Guarda de fonte: em `src/modules/ia/**`, toda menção a `patientCadastro` é a projeção acima (pega `select().from(patientCadastro)` e join da linha inteira); `campos-enviados.test.ts` ganha os marcadores dos campos novos em `proibidos`, com a fixture preenchendo **todos** os campos novos (com a coluna nula o marcador não provaria nada). A mudança da máscara (um nome a mais do próprio paciente) é conferida pelo `normas-cfn-lgpd` contra o texto 1.1 da autorização e a RN-109 (comentário de `pseudonimizar.ts`) antes do merge |
| RN-283 | **Anonimização** (D18). Em `anonimizarVencidos`, depois do UPDATE de `patients` (`if (r.length)`), `delete from patient_cadastro where patient_id = …` no contexto `worker`. Rede idempotente: a mesma varredura diária roda, no fim, `delete from patient_cadastro c using patients p where p.tenant_id = c.tenant_id and p.id = c.patient_id and p.anonimizado_em is not null` (contexto `worker`), para a linha deixada por uma imagem antiga na janela do deploy ou numa volta atrás. O gatilho `patient_cadastro_sem_apagar` só deixa apagar no contexto `worker` com `patients.anonimizado_em` não nulo (molde de `exam_submissions_sem_apagar`). No **bloqueio** (pedido de exclusão atendido) nada muda no cadastro |
| RN-284 | **Textos de interface** em pt-BR, numa constante (`MSG_CADASTRO`, `MSG_LISTA`, `MSG_FICHA`, `MSG_NO_APP`), e entram na tabela "Textos de interface" das histórias do MVP no fechamento |

---

## 7. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-260 | Desempenho | Início com p95 ≤ 800 ms (CS-263): as 8 seções em **uma** transação, uma consulta por seção (total por `count(*)` + os 3 últimos), só com os índices existentes (`anthropometry_paciente_data_idx`, `consultations_paciente_data_idx` e equivalentes); "No app" em duas transações (nutri e paciente). Se a medição pedir, as seções viram uma consulta só com subconsultas. Cenário "abrir a ficha" na pilha de carga (app com 2 vCPU, RNF-03 v1.14) |
| RNF-261 | Acessibilidade | WCAG 2.1 AA: axe sem violação no Início, Perfil, lista e `[id]/app`, em 1280 px e 360 px, claro e escuro; faixa de abas inteira a 1280 px (D12); seções em `<details>`/`<summary>` com o contador no texto; diálogo Adicionar com foco no título ao abrir e devolvido ao botão ao fechar; menu da linha com `aria-expanded`, nome acessível "Ações de {nome}", Esc e clique fora fecham, foco de volta ao botão (RN-273); seções com o título num `<h3>` dentro do `<summary>` (navegação por cabeçalhos) e "Ver todos" no corpo do `<details>`, nunca dentro do `<summary>`; o `<summary>` em `block min-h-11 py-2`, sem `flex` (que tira o marcador do disclosure); região `role="status"` da lista montada antes do texto aparecer (D26); formulário com `fieldset`/`legend` por seção; erros ligados ao campo (`aria-describedby`) e anunciados; alvos ≥ 44 px. O axe roda também com o menu da linha e o diálogo Adicionar **abertos**, nos dois temas (estados fora de `ROTAS_DO_PAINEL`; o tema vem da conta compartilhada: trocar com `escolherTema` e voltar a "Igual ao aparelho" no fim) |
| RNF-262 | Privacidade em log | Nada do cadastro complementar em log ou Sentry (regra 3) **nem no log do Postgres** (D23): os erros de validação logam só o nome do campo; o `sentry-filtro` (lista do que pode sair) não ganha nenhum campo novo; nenhuma entrada válida pelo `pacienteSchema` viola um CHECK de `patient_cadastro` (teste de fronteira por campo, contra o banco do Testcontainers); o CPF repetido não chega ao índice (pré-checagem). Teste que procura CPF, CEP e observação de teste no log capturado de um "Salvar" com erro |
| RNF-263 | Testes | (a) unitários de `cpf.ts` (válidos, inválidos, repetidos, com máscara), dos valores do formulário e do texto do "Cadastro incompleto"; (b) **paridade** do "No app": num cenário com conteúdo por etiqueta, receita sugerida no plano fora da audiência, documento cancelado e documento anonimizado, plano arquivado, envio cancelado, peso oculto e um segundo paciente arquivado, cada contagem de `noAppDoPaciente` é igual ao tamanho do que as funções do portal devolvem na sessão de paciente com login (`feedDeConteudos`, `documentosDoPaciente`, `planoDoPaciente` — receitas com `disponivel` —, `evolucaoParaPaciente`, `meusEnvios`, `jornadaDoPaciente`, `diarioDoPaciente` nos últimos 30 dias), com o cenário abaixo dos limites das listas do portal; o selo de cada item do Início é comparado **item a item** com o conjunto de ids que a função do portal devolve; o paciente arquivado não tem selo nem contagem; e um teste exige que toda seção com `noApp` do registro esteja no cenário; (c) **chaves**: `ItemDaSecao`, `listarPacientes` e o cartão do Início devolvem só as chaves das RN-272/RN-277; (d) **cobertura de colunas**: um teste lista as colunas de `patients` e de `patient_cadastro` (`information_schema`) e falha se aparecer coluna sem decisão registrada (exportação, anonimização, IA) — quem fizer merge depois do Plano 17 inclui `lembretes_pausados_em`; (e) integração com Testcontainers: RLS (público não lê nem grava a tabela; paciente com login lê só a própria linha e não grava; **paciente `semConta` não lê nem a própria linha**), unicidade do CPF com duas conexões (a segunda espera a trava e recebe a mensagem, sem 23505), gatilho de apagar, auditoria das escritas, anonimização apaga a linha, a rede da varredura apaga a linha esquecida, exportação traz os campos; (f) `listarPacientes` com abas, `status=` antigo, ordem, nome social e etiqueta; (g) E2E: cadastro com campos novos, lista (abas, ordem, arquivar), Início (seções, Adicionar), "No app"; ajuste dos seletores que o formulário novo quebra — `getByLabel('Telefone (opcional)')` deixa de existir (`agenda.spec.ts:72` e `:324`, `pacientes.spec.ts:27`) e `getByLabel('Nome')` fica ambíguo com "Nome completo" e "Nome social" (helper `e2e/portal.ts:21`, `pacientes.spec.ts:23` e `:36`, `ia-modelos.spec.ts:46`, `plano-alimentar.spec.ts:155`, `:236`, `:533` e `:570`, `acessibilidade.spec.ts:534`, `agenda.spec.ts:67` e `:320`; os de alimentos e da página pública não mudam) —, `pacientes.spec.ts:182` (`?status=arquivado`, que continua aceito pela RN-270), `e2e/painel-rotas.ts` e `e2e/acessibilidade-painel.spec.ts`; avisar as outras sessões quando o PR 2 entrar (os Planos 19 e 20 escrevem E2E novos sobre o helper `e2e/portal.ts`); (h) `[id]/impressao.test.ts`: o `expect(html).not.toContain('print:hidden')` do layout inteiro passa a "o `h1` não está dentro de elemento `print:hidden`" e "só a linha de medidas e as partes de tela do par de nomes têm `print:hidden`"; com nome social, a ordem impressa é nome civil → "Nome social: …" |
| RNF-264 | Manutenção | Seções e "No app" em `src/modules/ficha/`; a página Início só itera o registro; um plano novo acrescenta um arquivo em `secoes/` e uma linha no `index.ts` (§11) |

---

## 8. Telas e textos

### 8.1 Lista de pacientes (`/painel/pacientes`)

```
Pacientes                                                         [Novo paciente]
[ Ativos ] [ Inativos ] [ Todos ]                                    Ver bloqueados
Buscar por nome ou e-mail [________]  Etiqueta [Todas ▾]  Ordenar por [Nome (A–Z) ▾]  [Filtrar]

(região role="status", fixa: "Paciente arquivado.")
Nome                         Idade    E-mail            Acesso ao app   Desde        Ações
Ana Souza                    35 anos  ana@ex.com        Ativo           03/02/2025   [Ações ▾]
Joana Silva                  41 anos  jo@ex.com         Pendente        11/11/2026   [Ações ▾]
```

| Onde | Texto |
|---|---|
| Abas | "Ativos", "Inativos", "Todos"; link "Ver bloqueados" |
| Dica da aba Inativos | "Pacientes arquivados: sem acesso ao app e sem notificações. O prontuário continua guardado." |
| Título em bloqueados | "Bloqueados por pedido de exclusão (LGPD): só para consulta." + link "Voltar para a lista" |
| Ordem | "Ordenar por": "Nome (A–Z)", "Nome (Z–A)", "Mais recentes", "Mais antigos" |
| Colunas | "Nome", "Idade", "E-mail", "Acesso ao app" (era "Acesso ao portal"), "Desde", "Ações" |
| Acesso ao app de arquivado/bloqueado | "Sem acesso (arquivado)" / "Sem acesso (bloqueado)": a situação do paciente vence o `user_id` (o `estado: 'ativo'` de `situacaoDoAcesso` só olha o `user_id`); o mesmo vale no cartão "No app" e no Perfil |
| Vazio | "Nenhum paciente encontrado." (como hoje); aba Inativos sem busca: "Nenhum paciente arquivado." |
| Menu | "Ações de {nome}" (nome acessível); itens "Abrir ficha", "Editar cadastro", "Arquivar", "Reativar", "Pedir exclusão (LGPD)" |
| Confirmar arquivar (`ConfirmarBotao`, D26) | "Arquivar {nome}? O paciente perde o acesso ao app e deixa de receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar quando quiser." (botões do navegador) |
| Confirmar reativar (`ConfirmarBotao`, D26) | "Reativar {nome}? O paciente volta para os ativos e recupera o acesso ao app. Se ele ainda não entrou no app, reenvie o convite em Perfil." (botões do navegador) |
| Resultado (região `role="status"` fixa acima da tabela, D26) | "Paciente arquivado." / "Paciente reativado." |
| Manual guiado (guia `pacientes`, `versao` 1 → 2) | `busca-pacientes`: "Ache um paciente pelo nome ou pelo e-mail. As abas separam ativos e arquivados; os bloqueados ficam em Ver bloqueados." · novo `acoes-paciente`: "Em Ações você abre a ficha, edita o cadastro, arquiva ou reativa o paciente sem sair da lista." · nas `ajuda` do guia, trocar os itens que ficam falsos: "arquivados aparecem no filtro de situação" (o seletor "Situação" some; passa a "ficam na aba Inativos") e "use 'Reenviar convite' no prontuário" (passa a "na aba Perfil da ficha") |

### 8.2 Ficha: cabeçalho e abas

```
Pacientes
Joana Silva   [Peso oculto no app]
Nome de registro: João Silva
41 anos · Masculino · jo@ex.com
Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura 28,1%
[Início] [Perfil] [Antropometria] [Gasto energético] … [Histórico]
```

Na impressão (com nome social): "João Silva" / "Nome social: Joana Silva" / "41 anos · Masculino · jo@ex.com", sem a
linha de medidas (RN-266, RN-275).

| Onde | Texto |
|---|---|
| Sem avaliação | "Sem avaliação antropométrica." |
| Selo | "Peso oculto no app" (só com a opção ligada) |
| Nomes | Tela: título "{nome social}" + "Nome de registro: {nome}"; impressão: título "{nome}" + "Nome social: {nome social}" (RN-266) |
| Última aba | Rótulo "Histórico", nome acessível "Histórico de acessos" (D12) |
| Manual guiado | `cabecalho-paciente`: "Nome, idade, situação e as medidas da última avaliação, com a data. O selo mostra se o paciente está arquivado ou bloqueado." · `abas-prontuario`: "Início reúne o que já foi feito; Perfil guarda o cadastro. Cada parte do acompanhamento tem a sua aba." Os dois passos continuam no guia `prontuario` (`versao` 2 → 3; o `conteudo.test.ts` fixa `toBe(2)` em dois testes, que passam a 3), cujas `ajuda` também mudam: o resumo "Tudo do paciente em abas: anamnese, antropometria…" e o passo "Comece pela anamnese" passam a citar o Início e o Perfil |

### 8.3 Aba Início (`/painel/pacientes/{id}`)

```
[+ Adicionar]

Resumo                                    No app do paciente
Aniversário: 17 de maio                   Acesso: ativo · último acesso em 14/11/2026
Paciente desde 03/02/2025                 Plano alimentar publicado
Plano alimentar publicado em 10/11/2026   2 documentos · 12 conteúdos
                                          Ver detalhes
Cadastro incompleto: faltam estado civil e endereço. Completar no Perfil   (nota: Aviso tipo "aviso", papel "nenhum")

Inteligência artificial  [Pedir resumo à IA]   (US-120, como hoje)

▾ Plano alimentar (2)                        (<summary> com <h3>; "Ver todos" fica no corpo)
   Plano alimentar · 10/11/2026 · Publicado   [No app]
   Plano alimentar · 02/09/2026 · Arquivado
   Ver todos
▾ Antropometria (5)
   Avaliação · 12/10/2026  [No app]  …
   Ver todos
▸ Anamneses (0)
   Nenhum registro ainda.
…
```

| Onde | Texto |
|---|---|
| Botão | "Adicionar" (ícone "+", nome acessível "Adicionar ao prontuário") |
| Diálogo | Título "Adicionar ao prontuário"; grupos "Avaliações" e "Prescrições" (e "Outros", só quando uma seção registrada o usa, como o Financeiro do Plano 20); dica "Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético."; "Fechar" |
| Itens do diálogo | "Anamnese", "Antropometria", "Gasto energético", "Exame", "Atendimento", "Plano alimentar", "Receita", "Parecer nutricional" |
| Cartão Resumo | "Resumo"; "Aniversário: {dia} de {mês}"; "Paciente desde {data}"; "Plano alimentar publicado em {data}" / "Nenhum plano publicado" (o acesso ao app fica só no cartão "No app do paciente") |
| Nota | "Cadastro incompleto: faltam {itens}." (até 3 itens) / "Cadastro incompleto: faltam {n} dados." (4 ou mais) + "Completar no Perfil" |
| Nomes dos itens faltantes | "data de nascimento", "sexo", "identidade de gênero", "estado civil", "nacionalidade", "naturalidade", "escolaridade", "ocupação", "endereço", "telefone" |
| Seção | "{Título} ({n})" num `<h3>` dentro do `<summary>`; "Ver todos" no corpo do `<details>` (nome acessível "Ver todos: {Título}"); vazio "Nenhum registro ainda."; selo "No app" |
| Títulos das seções | "Plano alimentar", "Antropometria", "Gasto energético", "Anamneses", "Atendimentos", "Exames", "Exames enviados pelo paciente", "Documentos" |
| Peso oculto na seção Antropometria | "Peso e IMC ocultos no app." |
| Manual guiado | Guia **novo** `inicio-paciente` (`versao` 1, `padrao` `^/painel/pacientes/ID$`, posto **antes** do `prontuario` na lista `GUIAS`, porque o `prontuario` casa todas as abas e os passos abaixo só têm alvo no Início): `adicionar-prontuario`: "Um botão só para registrar anamnese, medidas, exames, atendimentos e prescrições." · `secoes-inicio`: "Cada seção mostra quantos registros há e os três mais recentes. O selo No app marca o que o paciente vê no app." · `no-app-cartao` (entra no PR 2, com o guia na `versao` 2): "O que o paciente enxerga no app, contado com as mesmas regras do app." Mais os passos `cabecalho-paciente` e `abas-prontuario` (os mesmos textos da §8.2) |

### 8.4 Aba Perfil (`/painel/pacientes/{id}/perfil`)

Seções, nesta ordem: **Dados gerais**, **Contato e endereço**, **Observação**, **Acesso ao app** e **Etiquetas**
(movida do Resumo, como está). Botão "Salvar cadastro" (como hoje). "Novo paciente" usa o mesmo formulário, sem
Acesso ao app (o convite sai ao salvar) e sem Etiquetas.

| Campo | Rótulo | Dica |
|---|---|---|
| nome | "Nome completo" | — |
| nome_social | "Nome social (opcional)" | "Preencha só a pedido do paciente. Aparece no painel junto do nome completo." |
| data_nascimento | "Data de nascimento" | — |
| sexo | como hoje (legenda "Sexo biológico (usado nas fórmulas)") | — (a legenda já diz) |
| identidade_genero | "Identidade de gênero (opcional)": "Mulher", "Homem", "Não binário", "Outra", "Prefere não informar" | "Como o paciente se identifica. As fórmulas usam o sexo biológico." |
| estado_civil | "Estado civil (opcional)": "Solteiro(a)", "Casado(a)", "União estável", "Separado(a)", "Divorciado(a)", "Viúvo(a)" | — |
| escolaridade | "Escolaridade (opcional)": "Sem escolaridade", "Ensino fundamental incompleto", "Ensino fundamental completo", "Ensino médio incompleto", "Ensino médio completo", "Ensino superior incompleto", "Ensino superior completo", "Pós-graduação" | — |
| ocupacao | "Ocupação (opcional)" | "Profissão ou atividade principal." |
| nacionalidade | "Nacionalidade (opcional)" | "Ex.: brasileira" |
| naturalidade | "Naturalidade (opcional)" | "Cidade e estado onde nasceu. Ex.: Campinas (SP)" |
| cpf | "CPF (opcional)" | "Para identificar o paciente sem engano. Não aparece na lista nem no app." ("recibos" só entra quando um plano usar o CPF de fato, §14) |
| email | "E-mail" | como hoje |
| telefone | "Celular / WhatsApp (opcional)" | "Ex.: (11) 91234-5678. Aceita fixo, mas os avisos de WhatsApp só saem para celular, se o paciente autorizar." |
| whatsappAutorizado, enviarConviteWhatsapp | como hoje (`paciente-form.tsx`), na seção **Contato e endereço**, logo abaixo do celular | como hoje (só valem com o celular preenchido) |
| telefone_fixo | "Telefone fixo (opcional)" | "Ex.: (11) 3123-4567" |
| endereço | legenda "Endereço (opcional)": "CEP", "Rua", "Número", "Complemento", "Bairro", "Cidade", "Estado" ("Selecione") | — |
| observacao | "Observação (opcional)" | aviso da US-260 + contador "{n} de 1.000 caracteres" |

Textos de erro: os da tabela da US-260. Bloqueado: "Paciente bloqueado por pedido de exclusão: o prontuário é só
para consulta." (como hoje). Manual guiado: `cadastro-paciente` (novo): "O cadastro fica em seções. Só nome,
nascimento, sexo e e-mail são obrigatórios; o resto completa o registro da primeira consulta." No Perfil, esse passo
fica num guia **novo** `perfil-paciente` (`versao` 1, `padrao` `^/painel/pacientes/ID/perfil$`, antes do `prontuario`);
em "Novo paciente", no guia `pacientes` (que casa `/painel/pacientes/novo`).

### 8.5 Página "No app do paciente" (`/painel/pacientes/{id}/app`)

```
No app do paciente
O que Joana Silva vê hoje no app do consultório. As contagens seguem as mesmas regras do app.

Acesso         Ativo: o paciente já criou a senha. · Último acesso em 14/11/2026
Notificações   Ativas em 1 aparelho · WhatsApp autorizado
Plano          Publicado em 10/11/2026 · 3 receitas sugeridas · Lista de compras disponível
Evolução       5 avaliações · Peso e IMC: ocultos no app (Não mostrar peso no app) · % de gordura: não aparece no app
Jornada        7 atendimentos
Documentos     2 documentos
Conteúdos      12 conteúdos na biblioteca
Exames         1 envio de exame
Diário         9 registros nos últimos 30 dias
IA Nutri       Ligada para este paciente
```

| Situação | Texto |
|---|---|
| Convite pendente | "Ainda não entrou no app. {textoDoAcesso}" |
| Sem convite | "Ainda não entrou no app." + link "Reenviar o convite no Perfil" |
| Arquivado | "Paciente arquivado: não vê nada no app até ser reativado." |
| Bloqueado | "Paciente bloqueado por pedido de exclusão: sem acesso ao app." |
| Nunca acessou | "Último acesso: nenhum ainda." |
| Sem push | "Notificações: desligadas em todos os aparelhos." |
| Plano | "Nenhum plano publicado." |
| Documentos desligados | a linha não aparece |
| IA Nutri | "Ligada para este paciente" / "Desligada" / a linha não aparece sem a IA Nutri ativada no consultório |
| % de gordura | "% de gordura: aparece no app" (com `tenants.mostrar_perc_gordura_paciente`) / "% de gordura: não aparece no app" |
| Receitas | "{n} receitas sugeridas" / "1 receita sugerida" (contadas como o cartão do plano no app, D24); a linha some sem receita |
| Plano | "Publicado em {dd/mm/aaaa}" (data da publicação no fuso) e "Lista de compras disponível" quando o plano publicado tem ao menos um item principal (a regra de `listaDoPlano`, `src/modules/portal/lista-compras.ts`); contados no contexto `nutri` |
| Lembretes (Plano 17) | "{n} lembretes ligados" / "1 lembrete ligado"; com algum desligado pelo paciente, "· {m} desligado(s) pelo paciente"; com a pausa do paciente, "Pausados pelo paciente"; a linha some sem lembrete configurado. Contados no contexto `nutri` (`lembretes_rotina.ligado`, `desligado_pelo_paciente_em`, `patients.lembretes_pausados_em`), sem ler `texto` nem `config`. "Notificações: ativas em {n} aparelho(s)" conta as inscrições de push do paciente, a mesma regra do Plano 17 (`aparelhosComNotificacao`) |

Cartão no Início: as linhas Acesso, Plano, Documentos e Conteúdos, mais "Ver detalhes". A linha "Lembretes" do Plano 17
fica só na página e é feita pelo Plano 18 (o 17 entra na `main` antes; revisão de 17/11). A página `[id]/app` cai no guia `prontuario`; a
explicação do "No app" fica nas `ajuda` do guia `inicio-paciente` (v2 no PR 2, junto do passo `no-app-cartao`).

---

## 9. Modelo de dados

**Uma tabela nova; nenhuma coluna nova em `patients`** (D1). Migration gerada + custom de RLS, numeradas no rebase
(D22), rodadas com `DATABASE_URL_MIGRATOR` (regra 7).

### 9.1 `patient_cadastro`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK, `gen_random_uuid()` | alvo do `entidade_id` do gatilho de auditoria (`r ->> 'id'`) |
| `tenant_id` | `uuid not null` | FK composta |
| `patient_id` | `uuid not null` | FK `(tenant_id, patient_id)` → `patients (tenant_id, id)`, `NO ACTION`; UNIQUE `patient_cadastro_paciente_unique (tenant_id, patient_id)` (1:1) |
| `cpf` | `text null` | CHECK `cpf ~ '^[0-9]{11}$'`; índice único parcial `patient_cadastro_cpf_unico (tenant_id, cpf) where cpf is not null`. Dígito verificador conferido no servidor (RN-261) |
| `nome_social` | `text null` | CHECK `char_length between 2 and 120` |
| `identidade_genero` | `text null` | CHECK na lista da US-260 |
| `estado_civil` | `text null` | CHECK na lista |
| `escolaridade` | `text null` | CHECK na lista |
| `ocupacao` | `text null` | 2–80 |
| `nacionalidade` | `text null` | 2–60 |
| `naturalidade` | `text null` | 2–80 |
| `telefone_fixo_e164` | `text null` | CHECK `~ '^\+[1-9][0-9]{7,14}$'` (o de `patients`) |
| `cep` | `text null` | CHECK `~ '^[0-9]{8}$'` |
| `logradouro`, `numero`, `complemento`, `bairro`, `cidade` | `text null` | CHECK de tamanho (US-260) |
| `uf` | `text null` | CHECK nas 27 UFs |
| `observacao` | `text null` | CHECK `char_length between 1 and 1000` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | — |

**Migration custom `rls_patient_cadastro`:**

```sql
SELECT app_enable_tenant_rls('patient_cadastro');
SELECT app_enable_patient_rls('patient_cadastro');
SELECT app_enable_audit('patient_cadastro', 'patients');
REVOKE TRUNCATE ON patient_cadastro FROM nutri_app_role;
-- D1: contexto de paciente sem sessão de login (semConta) não lê nem a própria linha
CREATE POLICY patient_cadastro_paciente_com_conta ON patient_cadastro AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
-- patient_cadastro_colunas_fixas (BEFORE UPDATE): tenant_id e patient_id não mudam (42501), comparados com
--   IS DISTINCT FROM (o UPDATE sem mudança, "set tenant_id = tenant_id" do teste de isolamento, passa)
-- patient_cadastro_sem_apagar (BEFORE DELETE): só app_current_role() = 'worker' com patients.anonimizado_em não nulo (42501)
```

- **Sem** `app_enable_staff_only` (é dado do titular, D3), **sem** `app_allow_publico`, **sem** `app_allow_paciente_escrita`.
- **Guardas** (`test/isolamento.test.ts`, só acrescentar no fim de cada lista, `sessoes-paralelas.md` §6), lista final:
  - `FABRICAS`: linha com o paciente do teste e `cpf` **nulo** (com CPF fixo, a fábrica de P1 e P2 cairia em
    `patient_cadastro_cpf_unico`);
  - `SEM_DELETE` e `IMUTAVEIS` (comentário: "Plano 18: patient_cadastro_colunas_fixas recusa mudar
    tenant_id/patient_id com 42501 antes da RLS; patient_cadastro_sem_apagar recusa o DELETE fora do worker");
  - filtro **obrigatório** em `SO_APAGA.patients`: `and not exists (select 1 from patient_cadastro c where
    c.tenant_id = patients.tenant_id and c.patient_id = patients.id)` (as linhas ficam por causa do `SEM_DELETE`, e a
    FK é `NO ACTION`);
  - **não** entra em `SO_INSERE`, `COM_MAE`, `ULTIMAS` nem `DELETE_REVOGADO`;
  - teste negativo novo: leitura com `semConta: true` devolve 0 linhas (política da D1).
  `rls-guard.ts` e `audit-guard.ts` não ganham entrada (tabela com RLS e gatilho comuns).
- **Auditoria:** entidade `patients` ("Cadastro do paciente"): as escritas no cadastro complementar aparecem no
  Histórico de acessos como o resto do cadastro. O `audit_log` não guarda o conteúdo da linha.
- **Drizzle:** `src/db/schema/pacientes.ts` (tabela nova) e `src/db/schema/index.ts` (reexporta).
- **Fora do banco:** nada de estado do Início ou do "No app" é gravado; tudo é leitura.

### 9.2 O que muda em código existente (resumo)

| Arquivo | Mudança |
|---|---|
| `src/modules/pacientes/pacientes.ts` | `pacienteSchema` com os campos novos (todos os CHECKs conferidos antes, D23); `criarPaciente`/`atualizarPaciente` gravam `patient_cadastro` na mesma transação, com a pré-checagem do CPF; o `set()` de `atualizarPaciente` continua listando coluna a coluna (a nota do Plano 17: a equipe nunca inclui `lembretes_pausados_em`); `buscarPaciente` traz `nome_social` por `left join` (RN-268); `cadastroDoPaciente` (RN-268); `listarPacientes` com aba, ordem, `nome_social`, `created_at` e o ponto de extensão do local (D11) |
| `src/modules/pacientes/cpf.ts` (novo) | `normalizarCpf`, `cpfValido`, `formatarCpf` |
| `src/modules/ficha/` (novo) | `secoes/` (registro, RN-277/RN-278), `cabecalho.ts` (RN-275), `incompleto.ts` (RN-269), `no-app.ts` (RN-281) |
| `src/app/painel/pacientes/[id]/` | `abas.tsx` (RN-274), `layout.tsx` (cabeçalho), `page.tsx` (Início), `perfil/page.tsx` (novo), `app/page.tsx` (novo) |
| `src/app/painel/pacientes/` | `page.tsx` (lista), `paciente-form.tsx` e `valores.ts` (seções e campos), `actions.ts` (arquivar/reativar pela lista) |
| `src/modules/pacientes/lgpd.ts`, `exportacao-job.ts`, `prontuario-pdf.tsx` | RN-283 e §10 (inclusive a rede da varredura e a identificação no PDF) |
| `src/app/painel/pacientes/[id]/privacidade/*` | Instrução do pedido de exclusão com o nome de registro (RN-266) |
| `src/modules/ia/*` | `nome_social` na máscara (RN-282) |
| `src/db/tenant.ts` | `SEM_CONTA_PERMITIDOS` + `src/modules/ficha/no-app.ts`, e os comentários de `semConta` |
| `src/modules/ajuda/conteudo.ts` | Guias novos `inicio-paciente` e `perfil-paciente`; `pacientes` v2 e `prontuario` v3; textos da §8 |

---

## 10. LGPD

| Tema | Tratamento |
|---|---|
| Finalidade e base | Identificação do paciente no prontuário e contato, em três grupos: (1) **campos que a Res. CFN 594/2017, art. 4º, § 1º, I manda registrar** (nome social, gênero, estado civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço, telefones): cumprimento de obrigação regulatória e tutela da saúde (LGPD, art. 7º, II, e art. 11, II, "a" e "f"), como o Termo 1.0 já cita (parágrafo 16); (2) **CPF e telefone fixo**: fora da 594 e não sensíveis; base do art. 7º **a definir com o advogado** (§14); (3) **observação**: texto livre do cadastro, que vai na cópia do titular (D3). O aceite do termo **não** é base do cadastro (o próprio termo diz que o prontuário continua sem o aceite, e o paciente da página pública também tem cadastro). O Termo 1.0 e o DPA 1.0 (cláusulas 2 e 5) já falam em "cadastro": na leitura das normas, os campos novos cabem sem versão nova — **a confirmar com o advogado (E-09)** |
| Minimização | Tudo opcional; CPF com a finalidade escrita junto do campo; sem etnia; sem busca de CEP externa; a lista e o Início não leem os valores (D20) |
| Transparência | Aviso junto da Observação (D3); a dica do CPF diz onde ele aparece |
| Acesso e portabilidade (art. 18, II e V) | O `dados.json` (escopos `titular` e `equipe`) ganha `paciente.cadastro`: `cpf` (formatado), `nomeSocial`, `identidadeDeGenero`, `estadoCivil`, `escolaridade` (os três com o **rótulo** que a tela mostra, art. 19, II), `ocupacao`, `nacionalidade`, `naturalidade`, `telefoneFixo` (formatado), `endereco` (`cep`, `rua`, `numero`, `complemento`, `bairro`, `cidade`, `uf`) e `observacao`; sem linha, `cadastro: null`. `montarDados` passa a ler `patient_cadastro` por inclusão explícita, com o comentário atualizado. O LEIA-ME da exportação cita o bloco novo. O **`prontuario.pdf`** (`prontuario-pdf.tsx`, seção "Identificação") ganha os campos da 594: o nome civil e, logo depois, "Nome social: …" (D7), gênero, estado civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço e os dois telefones; **sem** CPF (RN-262) e **sem** a observação (fica no `dados.json`), para a parte legível levar a identificação que a 594 pede quando o titular leva a cópia a outro profissional (Termo 1.0, parágrafo 23) |
| Bloqueio (pedido atendido) | O cadastro fica identificado, só para consulta, como o resto do prontuário (US-018). Apagar o CPF já no bloqueio é pergunta ao advogado (§14) |
| Anonimização | A linha de `patient_cadastro` é apagada (RN-283), com a rede idempotente na varredura diária para a janela do deploy ou uma volta atrás (§6.8.1 do manual técnico registra a rede); `patients` continua com o UPDATE de hoje. Teste: depois de `anonimizarVencidos`, nenhuma linha do titular e o `audit_log` com o "excluir" de ator nulo |
| IA | Nada do cadastro complementar vai à IA; o nome social só serve para a máscara (RN-282). A máscara fica mais rígida (um nome a mais do próprio paciente) e o texto 1.1 diz que ela "retira o seu nome": na leitura, sem mudança no texto da autorização (RN-109), mas o comentário de `pseudonimizar.ts` diz que mudar a regra da máscara muda o texto — **o `normas-cfn-lgpd` confirma antes do merge** |
| Log e Sentry | RNF-262 |
| Portal | O titular pode ler a própria linha pela RLS, mas o portal não a mostra na v1; o "No app" não lê o cadastro |

---

## 11. Fundação para os outros planos

O registro de seções é o ponto de encaixe da onda. Para pendurar uma seção, um plano:

1. cria `src/modules/ficha/secoes/<id>.ts` exportando uma `SecaoDaFicha` (RN-277), com rótulos genéricos e sem
   conteúdo clínico (teste de chaves);
2. acrescenta **uma linha** no fim de `SECOES_DA_FICHA` (`index.ts`), sem reordenar as outras;
3. se o paciente vê aquilo no app, implementa `noApp` (contagem no contexto de paciente) e acrescenta o caso ao teste
   de paridade;
4. se cria registro, preenche `adicionar` (grupo, rótulo, destino).

Contrato: o arquivo de uma seção **nunca** chama `auditRead` e nunca devolve conteúdo clínico (D14). A seção que
devolve dado auditado declara `leitura: { entidade }` e `inicio.ts` grava a leitura (uma por abertura, só com itens);
"Ver todos" fora da ficha vai em `verTodos`; o Adicionar aceita destino absoluto e o grupo `'outros'`; e o `resumo`
pode esconder o `adicionar` com `podeAdicionar: false` (RN-277). Fora disso, é mudança de contrato, decidida com a
orquestradora e o `revisor-rls`.

Usos previstos (premissa P-6): **Plano 17** — a linha "Lembretes" do "No app" é feita pelo Plano 18 (T9), porque o 17
entra antes; o 17 não registra nada; **Plano 19** — itens novos do plano alimentar ficam dentro da seção existente;
o `noApp` e a paridade das listas de substituição e dos materiais ligados ao plano (`plano_listas_substituicao`,
`plano_conteudos`) são somados no contexto `nutri` (D24) por quem entrar depois — o 18 na T9, se o 19 já estiver na
`main`, ou o 19 no plano dele; **Plano 20** — **seção** "Financeiro" (F-D18 acertada, US-308, RN-329) com
`leitura: { entidade: 'financeiro' }`, `verTodos` para a lista filtrada, "Nova entrada" no grupo `'outros'` e
`podeAdicionar` pela configuração do Financeiro; **Plano 23** — filtro de local em `listarPacientes`.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-260 | Conflito de migration com o Plano 17 (`0118`/`0119`) e de `drizzle/meta` | D22: gerar de novo no rebase, uma migration por vez na fila; a fundação (PR 1) não tem migration |
| R-261 | Conflito em `abas.tsx` e `layout.tsx` com os Planos 17, 19 e 20 | PR 1 de fundação cedo; os outros planos penduram seções (§11) em vez de mexer na página; em `ABAS`, só acrescentar antes de `historico` |
| R-262 | A 13ª aba corta a faixa a 1280 px (axe "incomplete") | D12: rótulo "Histórico" já no PR 1, com `aria-label="Histórico de acessos"`; o axe a 1280 px confirma |
| R-263 | Renomear "Resumo", criar "Perfil" e os rótulos novos do formulário quebram E2E (`painel-rotas.ts`, `acessibilidade-painel.spec.ts`, `pacientes.spec.ts`, `agenda.spec.ts`, `plano-alimentar.spec.ts`, `ia-modelos.spec.ts`, `acessibilidade.spec.ts`, helper `e2e/portal.ts`) e o manual guiado | Ajustes listados em RNF-263 (g) e §8; o `getByLabel` com `exact: true`; `?status=` antigo aceito (RN-270); aviso às outras sessões quando o PR 2 entrar |
| R-264 | O "No app" divergir do portal se um módulo do portal mudar a regra | A contagem roda no contexto de paciente (o banco aplica as políticas) e o teste de paridade compara com as funções do portal |
| R-265 | Uso de `semConta` fora do fluxo de paciente sem login abre precedente | Só contagens, depois de conferida a sessão `nutri`; entrada nova em `SEM_CONTA_PERMITIDOS` com revisão do `revisor-rls`; o contexto de paciente vê **menos** que o da nutricionista |
| R-266 | Uma 14ª aba ("Financeiro", Plano 20) não cabe a 1280 px **nem com "Histórico"** | O Plano 20 trocou a aba por uma seção no Início (F-D18 acertada); o contrato do registro ganhou no PR 1 os pontos de extensão de que ela precisa (`leitura`, `verTodos`, grupo `'outros'`, `podeAdicionar`; RN-277, §11). Aba só com o menu lateral do backlog |
| R-267 | Filtro de etiqueta na aba "Todos" grava até 500 linhas de "Etiquetas" por consulta | Comportamento de hoje, mantido por regra 8; um INSERT só por lista (`auditRead` com lista) |
| R-268 | O cabeçalho grava uma leitura de antropometria a cada execução do layout (carregamento completo e cada `revalidatePath(…, 'layout')`) | `cache()` por requisição; volume aceito (uma linha por ação, não por aba) |
| R-269 | Um campo novo (ou a coluna do Plano 17) esquecido na exportação, na anonimização ou na IA | Teste de cobertura de colunas (RNF-263 d) e guarda de fonte da IA (RN-282) |
| R-270 | Seções do Início pesam na ficha (8 consultas) com o app em 2 vCPU | RNF-260: uma transação, índices existentes, cenário na pilha de carga |

---

## 13. Conflitos com sessões paralelas

| Sessão | O que disputa com o Plano 18 | Combinado |
|---|---|---|
| **Plano 17** (`nutridebby-a`, `plano-17-lembretes-rotina`) | `drizzle/` (`0118` a `0120`), `src/db/schema/pacientes.ts` (coluna `lembretes_pausados_em` em `patients` e gatilho `paciente_colunas` refeito na `0119`), `lgpd.ts`, `exportacao-job.ts`, `exportacao.test.ts`, `lgpd.test.ts`, `test/isolamento.test.ts`, `scripts/e2e-seed.ts`, `src/modules/plataforma/audit.ts`, `src/modules/ajuda/conteudo.ts` (guia `plano-alimentar` v2), `src/app/painel/pacientes/valores.test.ts` (`PatientRow` com `lembretesPausadosEm`) | O Plano 18 **não** mexe em `patients` nem no gatilho (D1). A migration do 18 é gerada depois da do 17 entrar (D22). A tarefa de LGPD do 18 espera o merge do 17 ou faz rebase nele; o teste de cobertura de colunas inclui `lembretes_pausados_em` se o 17 entrar antes. A linha "Lembretes" do "No app" é feita pelo 18 (§8.5, §11) |
| **Plano 19** (`nutridebby-b`, plano alimentar 2) | `src/app/painel/pacientes/[id]/plano-alimentar/*`, `src/modules/ajuda/conteudo.ts`, `e2e/painel-rotas.ts`, manual técnico; a política `paciente_conteudo_visivel` (refeita com o ramo de `plano_conteudos`); tabelas que o paciente vê pelo plano (`plano_listas_substituicao`, `plano_conteudos`); a lista de compras por dia da semana; `src/modules/ia/{pseudonimizar,resumo-dados,rascunho-dados}.ts`, `nutri-paciente/contexto.ts` e `campos-enviados.test.ts` (os mesmos arquivos da RN-282); `scripts/e2e-seed.ts` e `test/carga/seed.ts` | O Plano 18 só **lê** `meal_plans` e `meals` (contagem, situação e receitas sugeridas, D24) e linka para a aba; não toca nas telas do plano. O `noApp` e a paridade das listas e dos materiais ligados entram por quem chegar depois à `main` (o 18 na T9 ou o 19 no plano dele), contados no contexto `nutri` (D24, §11). Na máscara da IA, quem entra depois junta as duas mudanças e passa o nome social em `outrosNomes` também nos campos novos do 19 que vão à máscara (`descricao_livre`, a lista de substituição), com o caso em `campos-enviados.test.ts`. Os E2E novos do 19 criam pacientes pelo helper `criarPacientePeloFormulario` (PR 1 do 18), porque o PR 2 troca os rótulos "Nome" e "Telefone (opcional)" |
| **Plano 20** (`nutridebby-c`, financeiro) | `src/modules/ficha/secoes/` (seção "Financeiro", PD-33, US-308), `lgpd.ts`, `exportacao-job.ts`, `test/isolamento.test.ts` | O Plano 18 não toca `atendimentos.ts`, `presenca.ts` nem a tela da consulta (crítica do Plano 20, item 18). PD-33 entra em cima da ficha do 18 como **seção** "Financeiro" no Início (F-D18 acertada), com o contrato estendido do PR 1 (RN-277, §11); só a T12 do 20 depende do PR 1 do 18. Disputam também `SO_APAGA.patients`/`SEM_DELETE` do isolamento, o trecho de `anonimizarVencidos` (o UPDATE de `patients` vem antes do apagamento do 18), `privacidade/page.tsx`, `src/lib/sentry-filtro.ts` e o `TSX_FORA` do `conteudo.test.ts`. DPA: só o 20 sobe para a 1.1 nesta onda (R-309 de lá; §14, pergunta 2). Nome social nas telas e no CSV do Financeiro: decisão do 20 |
| Todas | `src/db/schema/index.ts`, `src/db/tenant.ts`, CLAUDE.md (regras 2 e 8), `docs/manual-tecnico/*`, índice dos planos, backlog | Só acrescentar; quem entra depois resolve no rebase (`sessoes-paralelas.md`, §6) |

---

## 14. Perguntas pendentes (não travam a v1)

- **Advogado (E-09):** (1) apagar o CPF já no bloqueio (LGPD, arts. 16, I e 18, IV)? E a unicidade do CPF continuar
  contando o paciente bloqueado (é usar o dado bloqueado numa operação nova, a deduplicação; art. 5º, XIII)? Até a
  resposta: a unicidade continua, como a do e-mail, e a mensagem sai sem o link quando o outro está bloqueado
  (US-260). (2) o "cadastro" do Termo 1.0 e do DPA 1.0 cobre os campos novos sem versão nova? (Nesta onda, só o Plano 20 sobe o DPA, para a 1.1; se a resposta for "não", o 18 entra na 1.1 ou vira 1.2, pela ordem dos merges.) (3) se a etnia entrar um
  dia, qual a base do art. 11? (4) qual a base do CPF e do telefone fixo (art. 7º; não estão na Res. 594)? (5)
  identidade de gênero e nome social são dado sensível (art. 5º, II, "vida sexual", por interpretação)? Muda a base ou
  a exibição na lista? Até a resposta: a lista mostra só o nome social (D7).
- **CRN-3:** (1) a ressalva "considerando as características de cada instituição" da Res. 594, art. 4º, § 1º, I alivia
  algum item no consultório? (2) um cadastro sem nenhum registro clínico pode ser apagado de vez? (3) a tela do painel
  conta como "registro" para a ordem "nome social a seguir ao nome civil" da Res. 594? Até a resposta: tela com o nome
  social primeiro, impressão e PDF com o nome civil primeiro (D7).
- **`normas-cfn-lgpd` (antes do merge):** acrescentar o nome social à máscara pede versão nova da autorização de IA
  (RN-109, comentário de `pseudonimizar.ts`)? Leitura da spec: não (a máscara fica mais rígida e o texto diz "retira o
  seu nome").
- **Contador:** se o CPF for usado em recibo ou nota fiscal, qual o requisito.

---

## 15. Decisões do dono

### 15.1 Respostas de 16/11/2026 ("aprovo todas as recomendações, pode seguir")

| Pergunta | Resposta | Onde |
|---|---|---|
| 1. Campos além do pedido | Pedido + nome social, gênero, nacionalidade, naturalidade e escolaridade, todos opcionais, sem etnia | D2 |
| 2. A Observação é de quem | Faz parte do cadastro e vai na cópia do titular, com aviso junto do campo; anotação só da equipe continua nas notas privadas | D3 |
| 3. CPF repetido | Não: único por consultório, opcional, com dígito verificador | D4 |
| 4. Navegação da ficha | Abas em cima; "Resumo" vira "Início" (Adicionar + seções com contador); cadastro na aba nova "Perfil"; menu lateral no backlog | D12 |
| 5. "O que está no app" | Cartão no Início + página de detalhe | D16 (o lugar; o mecanismo, contar no contexto de paciente, é troca de recomendação: §15.2) |
| 6. "Excluir" na lista | Leva ao pedido de exclusão LGPD existente; nada é apagado | D10 |

#### Correções da crítica incorporadas (conferidas no código, `main` 5482450)

1. `listarPacientes` já audita com filtro de etiqueta → RN-272 e R-267; o filtro de situação passa a lista de status
   (RN-270).
2. `patients` lida com `select()` no contexto público e no de paciente sem conta → D1 (tabela filha).
3. Observação "só da equipe" não caberia em `patients` → resolvido pela resposta 2 (D3).
4. Plano 17 acrescenta `patients.lembretes_pausados_em` e refaz `paciente_colunas` na `0119` → D1, §13 e RNF-263 (d).
5. Numeração fixa de migration → D22.
6. Fundação num PR próprio → D21.
7. Paridade do "No app" impossível por filtro exportado → D16/RN-281 (contexto de paciente) e RNF-263 (b).
8. "No app" incompleto → avaliações (com peso oculto), lista de compras e receitas do plano (§8.5).
9. Destino das seções do Resumo → Etiquetas e Acesso ao app no Perfil, resumo da IA no Início (US-262).
10. Auditoria do cabeçalho → D13/RN-275 (`cache`, revalidações, impressão e `impressao.test.ts`).
11. "Últimos 3" sem `auditRead` → só rótulos genéricos (D14/RN-278) e teste das chaves.
12. Telefone com fixo gravado → D6.
13. Arquivar apaga convites pendentes → texto da confirmação (§8.1) e teste.
14. "Excluir" engana → "Pedir exclusão (LGPD)" (D10).
15. Lista exata do "Cadastro incompleto" → RN-269.
16. Pontos do nome social → D7/RN-266 (só painel e máscara da IA).
17. CPF repetido com bloqueado e mensagem → RN-261 e US-260.
18. Itens do Dietbox sem destino → §3.2.
19. Planos 19, 20 e 23 penduram seções → premissa P-6 (revista em 16/11: o Plano 20 usava aba; em 17/11: o 20 voltou à seção, §15.4).

### 15.2 Recomendações aprovadas que esta spec troca (pede o OK explícito do dono)

O "aprovo todas as recomendações" de 16/11/2026 cobriu as `decisoesPropostas` da proposta
(`.sessoes/proposta-plano-18.json`). A crítica de completude e a revisão trocaram estas; o dono confirma na aprovação
do plano, e o `revisor-rls` revisa D1, D16 e a política nova:

| Recomendação aprovada (proposta) | Troca | Por quê |
|---|---|---|
| [0] Colunas opcionais em `patients`, sem tabela filha | **D1**: tabela filha `patient_cadastro` | Crítica, item 2: `patients` é lida com `select()` no contexto público e no de paciente sem conta, e inteira pela IA |
| [2] CPF mascarado (`***.456.789-**`) fora do formulário | **D4/RN-262**: o CPF não aparece em lugar nenhum fora do formulário e do `dados.json` | Mais restritivo; nenhuma tela precisa do CPF mascarado |
| [4] Anular os campos novos no UPDATE da anonimização | **D18/RN-283**: apagar a linha de `patient_cadastro` | Consequência da D1 |
| [10] Registro em `src/app/painel/pacientes/[id]/inicio/secoes/` | **D14**: `src/modules/ficha/secoes/` | Fora de `src/app` (pastas sem `page.tsx` e regras de rota, §17) |
| [12] Exportar os filtros do portal e reaproveitá-los no painel ("abrir a sessão do paciente pelo painel não é possível nem desejável") | **D16**: contar no contexto de paciente `semConta`, a partir do painel | Crítica, item 7: a audiência é aplicada por política RESTRICTIVE, não por filtro exportável; contar no contexto de paciente faz o banco aplicar as mesmas regras. A §15.1 atribuía a D16 à "resposta 5", mas essa resposta só decidiu o lugar (cartão e página), não o mecanismo |
| [13] Migration numerada a partir da 0120, sem RLS | **D22**: sem número; migration de RLS (D1) | `sessoes-paralelas.md`, §5; consequência da D1 |

### 15.3 Revisão de 16/11/2026 (lentes banco/RLS, normas, interface e completude)

Aplicados (todos conferidos no código do worktree): RLS I-1 (política `patient_cadastro_paciente_com_conta`, opção
"a"), RLS I-2 / completude I1 (D24), RLS M1 a M8 (RN-277 `TxDePaciente`, RN-281 filtros e limites, RN-279 selo pelo
contexto de paciente, RN-282 projeção e fixture, §9.1 listas e `IS DISTINCT FROM`, RN-268/RN-275 nome social e
`cache()` por id, comentários de `semConta`, rede da varredura); normas I-1 (D7, RN-266, impressão e PDF), M-1 (§10),
M-2 (lista só com o nome social; pergunta no §14), M-3 (US-260, §14), M-4 (§10, RN-262), M-5 (RN-266, US-260), M-6
(D4, D16); interface I-1 (D25, RN-280), I-2 (D12), I-3 (D26), I-4 (§8.1, RN-279), I-5 (guias novos e versões, §8),
I-6 (dica do CPF), M-1 a M-9 (RNF-261, RNF-263 h, RN-273, RN-270, US-260, RN-269/RN-276, §8.5, §8.4); completude I2
(D25), I3 (D23), I4 (§11, §13), I5 (P-6, §11, R-266), I6 (§15.2), M1 (RN-282, §14), M2 (RN-268), M3 (D1), M4
(RNF-263 g), M5 (D22, §13), M6 (§13, §9.2), M7 (RN-278, §8.3).

Descartados ou trocados, com o porquê:
- RLS I-1 opção "b" (guarda de fonte em vez de política): trocada pela "a", que o próprio revisor recomenda e não
  depende de cada arquivo novo de `SEM_CONTA_PERMITIDOS`.
- Completude M2 (o cabeçalho tira o `nome_social` de `carregarCabecalho`): trocado pela normas M-7 (`buscarPaciente`
  com `left join`), porque essa leitura já é auditada como "Cadastro do paciente" e alimenta o cabeçalho e as abas
  numa consulta só; `carregarCabecalho` continua só com a antropometria.
- Completude I3 opção "unicidade sobre um hash": trocada pela pré-checagem com trava (D23), que mantém o índice simples
  e a mensagem com o link.
- Interface I-2, "registre que o Plano 20 não pode ser aba": parcial. Registrado que a 14ª aba não cabe (R-266); a
  decisão fica com o Plano 20 e a orquestradora, porque a spec do 20 já é de aba (completude I5).
- Interface I-3 opção `<dialog>` próprio: trocada pelo `ConfirmarBotao` existente (D26); os botões "Arquivar"/"Voltar"
  saíram da spec.
- Interface M-6 "saída que preserve os valores": resolvido abrindo o cadastro existente em nova aba (o formulário
  continua com o que foi digitado), sem mecanismo novo.
- Normas I-1 (b): a ordem na **tela** continua com o nome social primeiro até o CRN-3 responder (§14), como o revisor
  deixou à decisão do dono; a impressão e o PDF seguem a norma já.

### 15.4 Revisão do plano de 17/11/2026 (executabilidade, banco/guardas, conflitos com os Planos 17, 19 e 20)

O que mudou nesta spec (o resto foi só no plano): o contrato do registro ganhou `leitura`, `verTodos`, `href`
absoluto, o grupo `'outros'` e `podeAdicionar` (D14, RN-277, §11, P-6, R-266, §13), porque o Plano 20 trocou a aba
"Financeiro" por uma seção no Início com leitura auditada (F-D18 de lá) e o PR 1 congela o contrato — aplicada a
recomendação da revisão de conflitos (a alternativa, o 20 tirar o `auditRead` da seção, fica com o dono e o 20); a
linha "Lembretes" do "No app" passa ao Plano 18 (§8.5, §11, §13), porque o 17 entra antes e não a registra; a linha
"Plano" ganha a regra da lista de compras e da data (§8.5, RN-281); a âncora da Anamnese é o `<select id="modelo">`
(RN-280), sem título novo; o envio do paciente abre fora da ficha (RN-277); o DPA (§14, pergunta 2) e os conflitos
com o 19 e o 20 (§13). Descartado: a política sem conta também exigir `patients.user_id = app_current_user()` (opcional
na revisão de banco): `requirePaciente` já garante o vínculo, e a condição a mais pode esvaziar os testes positivos do
isolamento, cuja sessão de paciente usa um `actorUserId` que não é a conta do paciente da fábrica; fica para o
`revisor-rls` reavaliar na T5.

---

## 16. Critérios de aceite do plano (resumo para o fechamento)

- [ ] `patient_cadastro` com RLS de tenant e de paciente, política `patient_cadastro_paciente_com_conta`, auditoria
      (`patients`), colunas fixas, DELETE só do worker com titular anonimizado; fora de `PUBLICO_LIBERADO`,
      `PACIENTE_ESCREVE` e `STAFF_ONLY`; guardas e isolamento verdes.
- [ ] Público e sessão de paciente não gravam o cadastro complementar; paciente com login lê só a própria linha;
      paciente `semConta` não lê nada (teste).
- [ ] CPF opcional, validado, único por consultório e conferido antes do INSERT; nunca na lista, em URL, em log (da
      aplicação e do Postgres), em mensagem ou na IA (CS-262).
- [ ] Formulário em seções no Perfil e em "Novo paciente", com os rótulos e dicas da §8.4; agendamento público
      continua sem os campos novos.
- [ ] Lista com abas, "Ver bloqueados", ordenação, "Desde", nome social e menu por linha; arquivar pela lista apaga os
      convites pendentes e avisa; "Pedir exclusão (LGPD)" só leva à Privacidade.
- [ ] Abas "Início" e "Perfil"; última aba "Histórico" (nome acessível "Histórico de acessos"); faixa inteira a 1280 px no axe.
- [ ] Cabeçalho com a última antropometria e a data, uma leitura auditada por requisição, fora da impressão.
- [ ] Registro de seções com as 8 seções, contador, 3 últimos com rótulo genérico, selo "No app" e "Ver todos"; sem
      `auditRead` nas 8; o ponto de extensão `leitura` grava uma leitura só com itens; teste das chaves.
- [ ] Botão "Adicionar" com os grupos e a dica; sem Receita/Parecer quando os documentos estão desligados; ausente para
      bloqueado.
- [ ] "No app do paciente" (cartão e página) com contagens no contexto de paciente, a linha "Plano" com a data e a lista
      de compras e a linha "Lembretes" do Plano 17; teste de paridade verde (CS-261).
- [ ] `dados.json` com `paciente.cadastro` nos dois escopos; anonimização apaga a linha; teste de cobertura de colunas.
- [ ] `nome_social` na máscara da IA; guarda de fonte e `campos-enviados.test.ts` atualizados.
- [ ] Manual guiado (`data-guia` da §8, guias `inicio-paciente` e `perfil-paciente`, `pacientes` v2, `prontuario`
      v3), manual técnico (§2.5.4, §4.2, cap. 05 §5.8.1, §6.8.1, README), CLAUDE.md (regras 1, 2 e 8,
      `patient_cadastro`), `SEM_CONTA_PERMITIDOS` e os comentários de `semConta`, manual do usuário e Central de Ajuda
      atualizados.
- [ ] Pilha de carga com o cenário "abrir a ficha" dentro da meta (CS-263).

---

## 17. Referências

- Res. CFN 594/2017 (registro em prontuário), arts. 1º a 4º: https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm (conferida em 16/11/2026); Res. CFN 733/2022, art. 8º (só reescreve o art. 1º da 594).
- LGPD (redação compilada): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm — arts. 5º (II, XI, XIII), 6º (I, III, VI, VII), 11, 12, 16, 18, 19, 37 e 46.
- Código: `src/db/schema/pacientes.ts`, `src/modules/pacientes/{pacientes,lgpd,exportacao-job,convite-paciente,telefone,base}.ts`, `src/modules/agenda/agendamento-publico.ts`, `src/db/rls-guard.ts`, `src/db/tenant.ts`, `src/db/sem-conta-guarda.test.ts`, `src/modules/ia/{pseudonimizar.ts,campos-enviados.test.ts}`, `src/app/painel/pacientes/**`, `drizzle/0007_auditoria_funcoes.sql`, `drizzle/0051_rls_consultas.sql`, `drizzle/0085_paciente_colunas.sql`.
- Next.js desta versão: pastas sem `page.tsx` não viram rota; pastas privadas `_nome` (`node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`, "Private folders") — o registro fica em `src/modules/ficha/`, fora de `src/app`.
- Plano 17: `nutridebby-a/docs/superpowers/specs/2026-11-13-nutridebby-lembretes-de-rotina-design.md` e `…/plans/2026-11-13-nutridebby-17-lembretes-rotina.md`.
- Sessões paralelas: `docs/operacao/sessoes-paralelas.md` (branch `docs/sessoes-paralelas`, PR #50), §§3–7.
- Plano 19: `nutridebby-b/docs/superpowers/specs/2026-11-16-nutridebby-19-plano-alimentar-2-design.md` (§9, §13). Plano 20: `nutridebby-c/docs/superpowers/specs/2026-11-16-nutridebby-20-financeiro-design.md` (US-308, F-09, DEP-F8, R-302).
- Código citado na revisão: `drizzle/0000_base_roles_e_rls.sql` (`app_enable_patient_rls`), `src/modules/portal/{plano,conteudos,exames-enviados,diario}.ts`, `src/modules/plano-alimentar/carregar.ts`, `src/modules/portal/conteudos.test.ts` (guarda da liberação), `src/components/confirmar-botao.tsx`, `src/modules/ajuda/conteudo.ts`, `src/modules/pacientes/prontuario-pdf.tsx`, `src/app/painel/pacientes/[id]/{abas.tsx,layout.tsx,impressao.test.ts,anamnese/,documentos/page.tsx}`.
