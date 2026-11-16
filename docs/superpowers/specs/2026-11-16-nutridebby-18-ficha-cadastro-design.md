# NutriDebby — Ficha e cadastro do paciente (Plano 18) — Design

| Item | Valor |
|---|---|
| Versão | 0.1 |
| Data | 2026-11-16 |
| Status | **Decisões do dono tomadas** em 16/11/2026 ("aprovo todas as recomendações, pode seguir": perguntas 1 a 6 da proposta, §15). Spec à espera da revisão do plano. Conferida contra o código da `main` 5482450 (última migration: `0117_ia_nutri_funcoes.sql`) e contra o branch `plano-17-lembretes-rotina` (worktree `nutridebby-a`, commit 8396c53) |
| Itens do backlog | Paridade Dietbox, onda 1: **PD-10** (cadastro ampliado), **PD-11** (lista de pacientes), **PD-12** (ficha "Início": cabeçalho, botão Adicionar, seções com contador — **fundação** que outros planos usam) e **PD-13** ("O que está no app") |
| Quando | **Plano 18**, em paralelo com os Planos 17 (`nutridebby-a`), 19 (`nutridebby-b`) e 20 (`nutridebby-c`). Regras de convivência em `docs/operacao/sessoes-paralelas.md` (branch `docs/sessoes-paralelas`) |
| Documentos de base | [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) (RN-06, RN-08, RN-17), [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (US-007, US-010, US-018, US-019), [`2026-10-03-nutridebby-documentos-assinados-design.md`](2026-10-03-nutridebby-documentos-assinados-design.md) (D17: listas sem conteúdo; `tenant_signer`, CPF fora de tabela lida em contexto público), [`2026-10-08-nutridebby-app-paciente-g-design.md`](2026-10-08-nutridebby-app-paciente-g-design.md) (RN-203, "Não mostrar peso no app"), manual técnico caps. [02](../../manual-tecnico/02-banco-de-dados.md) (§2.5.4) e [04](../../manual-tecnico/04-modulos-clinicos.md) (§4.2) |
| Referência funcional | Dietbox (cadastro, lista, ficha e "Disponível no app"). Copiamos a **função**, nunca marca, texto ou layout |
| Numeração nova | US-260 a US-264 · RN-260 a RN-284 · RNF-260 a RNF-264 · CS-260 a CS-263 · R-260 a R-270 · D1 a D22 (decisões deste documento, citadas fora dele como "Plano 18, Dn"). A faixa 220–259 ficou de propósito para as specs dos Planos 19 e 20, escritas ao mesmo tempo a partir da mesma `main` (a próxima livre que elas vão achar é a 220). Quem fizer merge depois confere colisão com `grep -rhoE '\b(US|RN|RNF|CS|R)-2[2-9][0-9]\b' docs` |

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
| CS-260 | A nutricionista chega a qualquer registro do paciente (criar ou abrir) a partir do Início em **≤ 2 cliques** | E2E: do Início, "Adicionar" → tipo (2 cliques) e seção → item (2 cliques), para cada seção do registro |
| CS-261 | **Nenhuma** divergência entre o que "No app do paciente" diz e o que a sessão de paciente enxerga | Teste de paridade (RNF-263 b) num cenário com conteúdo por etiqueta, documento cancelado, plano arquivado e peso oculto |
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
| P-6 | Os Planos 19, 20 e 23 **penduram seções** no registro do Início. É premissa a confirmar com a orquestradora (o Plano 20 já planeja a aba "Financeiro" esperando o Plano 18; o 19 e o 23 não têm spec no repositório) | Crítica da proposta, item 19 |
| P-7 | Uma migration por vez na fila de merge; a do Plano 18 é **gerada de novo** em cima da `main` do momento (`sessoes-paralelas.md`, §5) | PD-01 |

---

## 2. Decisões (D1 a D22)

As decisões D2, D3, D4, D12, D16 e D10 são as respostas do dono às perguntas 1 a 6 da proposta (16/11/2026). As
demais são de desenho, tomadas aqui com o porquê, e incorporam as correções da crítica de completude conferidas no
código.

| ID | Decisão | Porquê |
|---|---|---|
| **D1** | Os campos novos ficam numa **tabela filha 1:1, `patient_cadastro`**, e não em colunas de `patients` | (a) `patients` está em `PUBLICO_LIBERADO` (select e insert, `rls-guard.ts:141`) e é lida com `select()` da linha inteira no contexto `publico` (`agendamento-publico.ts:209`) e no de paciente sem conta (`convite-paciente.ts:151`); com a tabela filha, o banco nega CPF, endereço e observação a esses contextos (`publico_negado` nasce com `app_enable_tenant_rls`), sem depender de cada leitura ter projeção — o mesmo motivo que tirou o CPF de `tenants` para `tenant_signer` (spec de documentos, RN-145). (b) Resumo, rascunho e leitura da IA leem `patients` inteira (`resumo.ts:121`, `rascunho-ia.ts:121`, `leitura-job.ts:98`); com a tabela filha, um campo novo nunca vai à IA por acidente. (c) Não toca em `patients` nem no gatilho `paciente_colunas`, que o Plano 17 refaz na `0119` (coluna `lembretes_pausados_em`): some o conflito mais difícil da onda. Custo aceito: migration de RLS, auditoria e entradas nas guardas (§9) |
| **D2** | Campos: os do pedido (CPF, estado civil, ocupação, telefone fixo, endereço, observação) **mais nome social, identidade de gênero, nacionalidade, naturalidade e escolaridade**, todos opcionais; **sem etnia** | Pergunta 1. A Res. CFN 594/2017, art. 4º, § 1º, I diz que o nutricionista "deverá" registrar esses dados; opcionais, não travam o agendamento público. Etnia é dado sensível (LGPD, art. 5º, II) e espera o CRN-3 e o advogado |
| **D3** | A **Observação** faz parte do cadastro e **vai na cópia do titular**; junto do campo, o aviso de que o paciente pode receber cópia; anotação só da equipe continua nas notas privadas do atendimento | Pergunta 2. Segue o direito de acesso (LGPD, art. 18, II) sem nova consulta ao advogado. Como vai na cópia, cabe na tabela filha legível pelo próprio titular (não precisa de `staff_only`) |
| **D4** | **CPF opcional, com dígito verificador, único por consultório**; aparece só no formulário do Perfil; nunca na lista, em URL, em log, em mensagem ou no `audit_log`; **sem busca por CPF** | Pergunta 3. Nenhuma norma do CFN pede CPF (594, 656/2020, 760/2023); LGPD, art. 6º, III. A busca por GET poria o CPF na URL e no histórico do navegador. O gatilho de auditoria grava só id, titular, ator e IP (`0007`), sem o conteúdo da linha |
| **D5** | **E-mail continua obrigatório**; nascimento e sexo continuam obrigatórios salvo no agendamento público (CHECK `patients_nascimento_e_sexo`) | É o login do app e a chave única no consultório; o Termo 1.0 promete a cópia e o aviso de incidente por e-mail. Torná-lo opcional pediria versão nova do termo |
| **D6** | O telefone de hoje passa a se chamar **"Celular / WhatsApp"**, **sem recusar fixo** e **sem mover dados**; o fixo ganha campo próprio | `normalizarTelefone` aceita fixo (8 dígitos começando com 2–5) e há cadastros com fixo em `telefone_e164`. Recusar quebraria a edição desses cadastros; mover seria migration de dados no banco de produção (regra 3 do servidor). A dica do campo orienta |
| **D7** | **Nome social só no painel**: cabeçalho da ficha, lista e busca; e entra na **máscara da IA**. Portal, e-mails, agenda, convites e documentos assinados continuam com o nome de registro (backlog) | Limita a mudança a poucos pontos testáveis. Documento assinado copia o nome (RN-154) e precisa do nome de registro; o uso no app e nos e-mails pede revisão de textos e do termo e fica para um item próprio. A máscara precisa dele: se a nutricionista escrever o nome social num texto livre, ele não pode sair para a IA |
| **D8** | Cadastro em **página** (aba Perfil e "Novo paciente"), dividido em seções; **não** modal | Funciona melhor no celular e com leitor de tela; é o padrão do painel. Copiamos a função (dados agrupados), não o layout |
| **D9** | Lista com abas **Ativos** (padrão), **Inativos** (= arquivados) e **Todos** (ativos + arquivados); **Bloqueados** num filtro à parte, com o selo; ordenação e coluna **Desde** | O bloqueio é a suspensão do tratamento (LGPD, art. 5º, XIII) e não se mistura ao dia a dia (US-018) |
| **D10** | Menu por linha: Abrir ficha, Editar cadastro, Arquivar/Reativar (com confirmação) e **"Pedir exclusão (LGPD)"**, que leva ao pedido de exclusão da aba Privacidade; **nada é apagado** | Pergunta 6. O prontuário é guardado por 20 anos (Res. 594, art. 3º, VI, "b"). O rótulo "Excluir" enganaria: o fluxo existente bloqueia e anonimiza no prazo e exige digitar o nome (`MSG_LGPD.confirmarNome`) |
| **D11** | Local de atendimento: **nada** na tela nem no banco agora; `listarPacientes` só ganha o ponto de extensão (o filtro já é objeto) | Os locais nascem no Plano 23 (PD-70); coluna reservada agora seria palpite |
| **D12** | Ficha com **abas em cima**: "Resumo" vira **"Início"**, o cadastro vai para a aba nova **"Perfil"** (logo depois de Início). Se as 13 abas não couberem a 1280 px, o rótulo da faixa "Histórico de acessos" encurta para **"Histórico"** (o título da página continua "Histórico de acessos") | Pergunta 4. A faixa mede 1213 de 1232 px com 12 abas (`abas.tsx`, comentário); a 13ª pode cortar a última e gerar "incomplete" no axe |
| **D13** | O **cabeçalho** mostra altura, peso, IMC e % de gordura da **última antropometria, com a data**, lidos **uma vez por requisição** (`cache()` do React, ao lado de `carregarProntuario`) com **um** `auditRead` (entidade `antropometria`); a linha de medidas **não sai na impressão**; com "Não mostrar peso no app" ligado, o selo "Peso oculto no app" | Regra 8 (dado de saúde). O layout não roda de novo entre abas irmãs, mas roda no carregamento completo e a cada `revalidatePath(…, 'layout')` das actions (ex.: `antropometria/actions.ts`): uma linha "Visualizou" por execução, aceita. Fora da impressão porque a folha impressa pode ir para a mão do paciente com o peso oculto (RN-203) |
| **D14** | **Registro de seções** em `src/modules/ficha/secoes/` (um arquivo por seção + `index.ts`); cada seção devolve **contador e últimos 3 itens só com rótulo genérico, data e situação**, sem `auditRead` | Fundação: os outros planos acrescentam um arquivo e uma linha, sem disputar a página. Sem conteúdo clínico, segue o precedente da agenda, da lista de pacientes e das listas de documentos (P05 D10, 10A D17). Nome do modelo de anamnese ou do exame é dado de saúde ("Anamnese gestante", "Glicemia"): não aparece |
| **D15** | **Botão "Adicionar" único** no Início, alimentado pelo mesmo registro, em dois grupos (Avaliações, Prescrições) | Um caminho só para criar qualquer registro; tipos que não existem no código não aparecem |
| **D16** | "No app do paciente" = **cartão no Início + página `[id]/app`**; a contagem roda no **contexto de paciente sem ator** (`semConta`), só com contagens, depois de conferido o acesso da nutricionista | Pergunta 5. A sessão `nutri` enxerga tudo e diria "está no app" quando não está (sigilo, Res. 594, art. 3º, IV). A audiência de conteúdo é aplicada por política RESTRICTIVE (`paciente_conteudo_visivel`, 0083) e por `app_conteudo_por_etiqueta`, não por filtro em TypeScript: contar no contexto de paciente faz o **banco** aplicar as mesmas regras. Precedente: `convite-paciente.ts:151` já lê pelo `withTenant({ role: 'paciente', patientId, semConta: true })` |
| **D17** | O aviso **"Cadastro incompleto"** considera uma **lista fechada** de campos (RN-269) | Sem lista, o aviso ficaria permanente (etnia e responsável legal estão fora) |
| **D18** | LGPD: os campos novos vão no `dados.json` dos **dois escopos** (titular e equipe); na **anonimização a linha de `patient_cadastro` é apagada** (só o `worker`, com o titular já anonimizado); no **bloqueio** nada muda (fica identificado, como o resto do prontuário) | Termo 1.0 e DPA (cláusula 5) prometem anonimizar "o cadastro"; estado civil, ocupação e CEP ajudam a reidentificar (LGPD, arts. 5º, XI e 12). Apagar o CPF já no bloqueio é pergunta aberta ao advogado (§14) |
| **D19** | **IA**: `patient_cadastro` nunca vai à IA; só `nome_social` é lido pela IA, e **só para a máscara** (`outrosNomes` de `AlvoDaMascara`) | Mandar qualquer campo novo mudaria "o que é enviado" (RN-109: versão nova da autorização). CPF e telefone já saem pelos padrões genéricos `CPF` e `TELEFONE` de `mascarar`, sem ler o valor |
| **D20** | A lista e o Início nunca leem CPF, endereço, telefone fixo, observação nem os demais campos novos, salvo `nome_social` (lista) e a **presença** dos campos do aviso (Início) | Minimização (LGPD, art. 6º, III); a aba Perfil é o único lugar que lê os valores |
| **D21** | Entrega em **dois PRs**: (1) **fundação, sem migration** — abas Início/Perfil, cabeçalho, registro de seções e botão Adicionar; (2) cadastro (migration), lista e "No app" | `sessoes-paralelas.md`, §7: fundação primeiro, num PR pequeno, para as outras sessões fazerem rebase em cima. Sem migration, o PR 1 não espera a fila de migrations |
| **D22** | A migration **não tem número prometido**: é gerada de novo em cima da `main` no rebase (esperado depois da `0118`/`0119` do Plano 17) | `sessoes-paralelas.md`, §5: duas migrations geradas da mesma `main` têm o mesmo número e uma pode ser pulada em silêncio pelo migrador |

---

## 3. Escopo

### 3.1 Dentro

| ID | Bloco | Conteúdo |
|---|---|---|
| PD-10 | Cadastro ampliado | Tabela `patient_cadastro` (D1); formulário em seções (Dados gerais; Contato e endereço; Observação; Acesso ao app) no Perfil e em "Novo paciente"; CPF com dígito verificador e único (D4); rótulo "Celular / WhatsApp" (D6); nome social no painel e na máscara da IA (D7); aviso "Cadastro incompleto" (D17); exportação e anonimização (D18) |
| PD-11 | Lista | Abas Ativos/Inativos/Todos e filtro Bloqueados; ordenação; coluna "Desde"; menu por linha; ponto de extensão do local (D11) |
| PD-12 | Ficha Início | Abas Início e Perfil (D12); cabeçalho com a última antropometria (D13); cartão Resumo; registro de seções com 8 seções (D14); botão Adicionar (D15) |
| PD-13 | No app do paciente | Cartão no Início e página `[id]/app` com contagens pelo contexto de paciente (D16) |
| — | Fechamento | Manual guiado (`data-guia`), axe, manual técnico (§2.5.4, §4.2, README), manual do usuário (Docs), Central de Ajuda, CLAUDE.md (regras 2 e 8) e `SEM_CONTA_PERMITIDOS` |

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
- Aba "Financeiro" (Plano 20, PD-33): o Plano 18 só deixa a faixa e o registro prontos (R-266).

---

## 4. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Ler e gravar o cadastro completo de paciente `ativo` ou `arquivado`; consultar o de `bloqueado`; arquivar e reativar pela lista; abrir o pedido de exclusão; ver o "No app" | Gravar cadastro de paciente bloqueado ou anonimizado (`carregarPacienteParaEscrita`); apagar a linha de `patient_cadastro` (gatilho, RN-283) |
| **Paciente** (sessão `paciente`) | Nada novo na tela. A RLS deixa o titular ler a própria linha de `patient_cadastro` (é dado dele, D3), mas o portal não a lê na v1 | Gravar `patient_cadastro` (`app_enable_tenant_rls` nega INSERT/UPDATE/DELETE à sessão de paciente; a tabela **não** entra em `PACIENTE_ESCREVE`) |
| **Público** (agendamento) | — | Ler ou gravar `patient_cadastro` (`publico_negado`; a tabela **não** entra em `PUBLICO_LIBERADO`). O paciente criado pela página pública nasce sem linha |
| **Worker** | Ler para a exportação; apagar a linha na anonimização; ler **só `nome_social`** para a máscara da IA | Ler outros campos para a IA (guarda, RN-282) |
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
| `logradouro` / `numero` / `complemento` / `bairro` / `cidade` | texto | Não | 2–120 / 1–10 / 1–60 / 2–60 / 2–60 | "Use no máximo {n} caracteres" |
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
  Então vejo "Já existe um paciente com este CPF neste consultório." e o link "Abrir o cadastro existente"
  E nada é gravado
  # vale também se o outro estiver arquivado ou bloqueado; depois da anonimização o CPF não existe mais

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
  E a URL leva "ordem=recentes", e a aba e a busca continuam aplicadas

Cenário: Nome social na lista e na busca
  Dado o paciente de nome "João Silva" com nome social "Joana Silva"
  Então a linha mostra "Joana Silva" e, abaixo, "Nome de registro: João Silva"
  E buscar "Joana" ou "João" acha o paciente

Cenário: Arquivar pela lista
  Dado um paciente ativo com convite pendente
  Quando abro "Ações de Ana Souza" e escolho "Arquivar"
  Então vejo "Arquivar Ana Souza? O paciente perde o acesso ao app e deixa de receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar quando quiser."
  Quando confirmo
  Então vejo "Paciente arquivado." e o convite pendente foi apagado (arquivarPaciente)

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

Cenário: Abas
  Então a primeira aba se chama "Início" e a segunda "Perfil"
  E o formulário de cadastro, o "Acesso ao app" (com "Reenviar convite") e as "Etiquetas" ficam no Perfil
  E o botão do resumo da IA (US-120) fica no Início

Cenário: Seções com contador
  Dado 3 anamneses, 5 avaliações e um plano publicado
  Então vejo as seções "Anamneses (3)", "Antropometria (5)" e "Plano alimentar (1)"
  E cada seção mostra até 3 itens com rótulo genérico, data e situação, e o link "Ver todos"
  E nenhum item mostra o nome do modelo da anamnese nem o nome do exame
  E abrir o Início não grava "ler" no audit_log para as seções

Cenário: Selo "No app"
  Dado que o paciente já entrou no app
  Então o plano publicado, as avaliações, os atendimentos, os documentos emitidos e os envios de exame levam o selo "No app"
  E anamneses, exames registrados pela nutricionista e cálculos de gasto energético não levam

Cenário: Cadastro incompleto
  Dado que faltam estado civil e endereço
  Então o cartão Resumo mostra "Cadastro incompleto: faltam estado civil e endereço." e o link "Completar no Perfil"
```

### US-263 — Botão "Adicionar" (PD-12) · **M**

```gherkin
Cenário: Um botão para criar qualquer registro
  Quando toco em "Adicionar" no Início
  Então abre o diálogo "Adicionar ao prontuário" com os grupos "Avaliações" (Anamnese, Antropometria, Gasto energético, Exame, Atendimento) e "Prescrições" (Plano alimentar, Receita, Parecer)
  E a dica "Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético."
  Quando escolho "Antropometria"
  Então abro o formulário de nova avaliação da aba Antropometria

Cenário: Documentos desligados
  Dado que o consultório não tem os documentos assinados liberados
  Então "Receita" e "Parecer" não aparecem

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
  Então esse conteúdo não entra na contagem de Ana

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
| RN-261 | **CPF.** Normalizado para 11 dígitos; o dígito verificador é conferido no servidor (`src/modules/pacientes/cpf.ts`: `normalizarCpf`, `cpfValido`, `formatarCpf`); CPF com 11 dígitos iguais é inválido. O banco confere o formato (CHECK) e a unicidade por consultório (índice único parcial). Corrida de dois cadastros com o mesmo CPF: quem decide é o índice (sem pré-checagem, como o e-mail); a violação vira a mensagem da US-260 e o link "Abrir o cadastro existente" (procurado no contexto `nutri`, que vê todos os pacientes do consultório). Erros nunca repetem o valor digitado |
| RN-262 | **Onde o CPF aparece.** Só no formulário do Perfil (o campo de edição) e no `dados.json` da exportação (formatado `000.000.000-00`). Nunca na lista, no cabeçalho, no Início, no "No app", em URL (o formulário é POST por Server Action), em log, no Sentry, em mensagem, e-mail, push ou WhatsApp. Sem busca por CPF |
| RN-263 | **Endereço.** CEP (8 dígitos, exibido `00000-000`), rua, número (aceita "s/n"), complemento, bairro, cidade e UF (lista fechada das 27). Só endereço no Brasil na v1. Nenhuma busca de CEP em serviço externo (P-2) |
| RN-264 | **Telefones.** "Celular / WhatsApp" é o `patients.telefone_e164` de hoje, com as regras de hoje (opt-in, convite por WhatsApp) e sem recusar fixo (D6). "Telefone fixo" é `patient_cadastro.telefone_fixo_e164`, normalizado por `normalizarTelefone`; nunca recebe WhatsApp nem aviso |
| RN-265 | **Observação.** Até 1.000 caracteres, com o aviso da US-260 junto do campo; vai na cópia do titular (D3); não vai à IA (RN-282); some na anonimização (RN-283) |
| RN-266 | **Nome social.** Preenchido só a pedido do paciente (dica do campo). No painel, onde houver nome social: o cabeçalho da ficha mostra o nome social como título e "Nome de registro: {nome}" abaixo; a lista mostra o mesmo par; a busca casa nos dois; a ordem por nome usa `coalesce(nome_social, nome)`. Em todo o resto (portal, e-mails, agenda, convites, documentos assinados, PDF do plano, Histórico de acessos), o nome de registro, como hoje (D7) |
| RN-267 | **Quem grava.** Só a sessão `nutri`, por `withTenant` com `actorUserId` e `ip`, depois de `carregarPacienteParaEscrita` (bloqueado ou anonimizado → `PacienteBloqueadoError`, a tela fica só leitura). O gatilho de auditoria grava "criar"/"alterar" com a entidade `patients` ("Cadastro do paciente" no Histórico de acessos) |
| RN-268 | **Leitura do cadastro complementar.** Só a aba Perfil lê os valores, por `cadastroDoPaciente(ctx, patientId)`, com `auditRead` próprio (entidade `patients`) na mesma transação. `carregarProntuario` (todas as abas) **não** traz os campos novos, para que CPF, endereço e observação nunca entrem no objeto `paciente` que as abas passam a componentes cliente. Abrir o Perfil grava, portanto, duas leituras de "Cadastro do paciente" (a do layout e a do Perfil): aceito |
| RN-269 | **"Cadastro incompleto"** (D17). O aviso aparece quando falta pelo menos um destes: data de nascimento, sexo, identidade de gênero, estado civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço (CEP, rua, número, bairro, cidade e UF; complemento não conta) e um telefone (celular **ou** fixo). Não contam: nome social (só a pedido), CPF (D4), observação, complemento. O Início lê só a **presença** de cada campo (`campo is not null`), nunca o valor — sem `auditRead`. Texto: "Cadastro incompleto: faltam {itens}." (itens em minúsculas, separados por vírgula e "e") + link "Completar no Perfil" |
| RN-270 | **Abas da lista.** `?aba=ativos` (padrão, `status = 'ativo'`), `inativos` (`arquivado`), `todos` (`status in ('ativo','arquivado')`); `?situacao=bloqueados` mostra só `bloqueado`, com o selo, sem as abas marcadas. Valor desconhecido cai no padrão. Busca, etiqueta e ordem combinam com qualquer aba. Limite de 500 linhas (`LIMITE_LISTA`), como hoje |
| RN-271 | **Ordem.** `?ordem=` `nome` (padrão, A–Z), `nome_desc` (Z–A), `recentes` (`created_at` desc), `antigos` (`created_at` asc); empate por `id`. O nome da ordem é o exibido (RN-266), com `unaccent` e sem diferença de maiúsculas |
| RN-272 | **Projeção da lista** (D20). `listarPacientes` seleciona só id, nome, `nome_social` (por `left join` em `patient_cadastro`), e-mail, status, nascimento, `user_id`, origem e `created_at`. A lista continua sem `auditRead`, **salvo** com filtro de etiqueta, que continua gravando uma leitura de "Etiquetas" por paciente devolvido (`pacientes.ts`, regra 8). Teste das chaves devolvidas |
| RN-273 | **Menu da linha.** Botão "Ações de {nome}" (disclosure acessível). Paciente ativo: Abrir ficha, Editar cadastro (→ Perfil), Arquivar, Pedir exclusão (LGPD). Arquivado: Abrir ficha, Editar cadastro, Reativar, Pedir exclusão (LGPD). Bloqueado: Abrir ficha. Arquivar e Reativar pedem confirmação (textos na §8) e chamam `arquivarPaciente`/`desarquivarPaciente` (`lgpd.ts`), as mesmas da aba Privacidade. "Pedir exclusão (LGPD)" é um link para `/painel/pacientes/{id}/privacidade#exclusao` e não grava nada |
| RN-274 | **Abas da ficha.** `ABAS` passa a: Início (`''`), Perfil (`perfil`), Antropometria, Gasto energético, Anamnese, Atendimentos, Exames, Evolução, Privacidade, Plano alimentar, Documentos (condicional), IA Nutri (condicional), Histórico de acessos — com a regra do comentário mantida ("Cada tarefa acrescenta a sua ANTES de 'historico'"). Se o axe acusar corte a 1280 px, o rótulo da última vira "Histórico" (D12). A aba Início fica marcada também em `[id]/app` e `[id]/resumo-ia` |
| RN-275 | **Cabeçalho** (D13). `carregarCabecalho = cache(async (ctx, patientId) => …)` lê a última linha de `anthropometry` (`order by data desc, created_at desc limit 1`) e, se houver, grava **um** `auditRead` (entidade `antropometria`, `entidadeId` da avaliação). Formato: altura em metros com vírgula e duas casas; peso com uma casa; IMC com uma casa; gordura com uma casa e "%", omitida quando nula; data `dd/mm/aaaa`. A linha tem `print:hidden`. Com `peso_oculto_no_app_em`, o selo "Peso oculto no app" ao lado (o painel continua mostrando o peso: RN-204) |
| RN-276 | **Cartão Resumo** do Início: "Aniversário: {dia} de {mês}"; "Paciente desde {dd/mm/aaaa}" (`created_at` no fuso); "Plano alimentar publicado em {dd/mm/aaaa}" ou "Nenhum plano publicado"; "Acesso ao app: {textoDoAcesso}"; o aviso da RN-269. Sem `auditRead` (nascimento e e-mail já foram lidos e auditados pelo `carregarProntuario`; o resto é contagem e data) |
| RN-277 | **Registro de seções** (D14). `src/modules/ficha/secoes/index.ts` exporta `SECOES_DA_FICHA`, uma lista ordenada; cada arquivo exporta uma `SecaoDaFicha`: `id`, `titulo`, `aba` (segmento da aba "Ver todos"), `disponivel(tenant, paciente)`, `resumo(tx, patientId) → { total, ultimos: ItemDaSecao[] }` (no máximo 3, mais recentes primeiro), `adicionar?: { grupo: 'avaliacoes' \| 'prescricoes'; rotulo; href }` e `noApp?: (txPaciente, patientId) → ContagemNoApp`. `ItemDaSecao` tem **exatamente** as chaves `id`, `rotulo`, `data`, `situacao` (opcional), `noApp` (booleano) e `href`. Todas as seções do Início rodam numa transação (`withTenant` da sessão `nutri`) |
| RN-278 | **Seções do Plano 18**, na ordem: Plano alimentar (rótulo "Plano alimentar", situação Rascunho/Publicado/Arquivado), Antropometria ("Avaliação"), Gasto energético ("Cálculo"), Anamneses ("Anamnese", sem o nome do modelo), Atendimentos ("Atendimento"), Exames ("Exame", sem o nome), Exames enviados pelo paciente ("Envio do paciente", com a situação do envio; só com o recebimento ligado ou algum envio, como a RN-192) e Documentos ("Receita"/"Parecer", com a situação; só com `documentosLiberados`). Seção vazia: "Nenhum registro ainda." O `<details>` de cada seção abre por padrão quando `total > 0` |
| RN-279 | **Selo "No app"** por item, só quando o acesso do paciente está ativo (conta criada e vínculo ativo): plano `publicado`; toda avaliação (a Evolução do app mostra as avaliações; com peso oculto, a seção diz "Peso e IMC ocultos no app"); todo atendimento (a Jornada mostra as consultas e a orientação); documento que a política `paciente_so_emitidos` deixa o paciente ver; todo envio de exame não cancelado. Anamneses, exames da nutricionista e gasto energético nunca têm selo. A regra de cada seção é conferida pelo teste de paridade (RNF-263 b) |
| RN-280 | **Adicionar** (D15). Diálogo modal nativo (`<dialog>`), título "Adicionar ao prontuário", montado a partir das seções com `adicionar` e `disponivel`. Avaliações: Anamnese (`anamnese/nova`), Antropometria, Gasto energético, Exame, Atendimento (formulários das abas, por âncora). Prescrições: Plano alimentar (aba Plano alimentar, criar), Receita e Parecer (aba Documentos; só com `documentosLiberados`). Não aparece para paciente bloqueado ou anonimizado. Tipos sem tela no código não aparecem |
| RN-281 | **"No app do paciente"** (D16). `noAppDoPaciente(ctx, patientId)` (`src/modules/ficha/no-app.ts`): (1) no contexto `nutri`, lê status, anonimização, situação do acesso (`situacaoDoAcesso`), último dia em `access_events`, inscrições de push, opt-in de WhatsApp, `peso_oculto_no_app_em`, participação na IA Nutri e `tenants.mostrar_perc_gordura_paciente`; (2) só se o paciente está `ativo`, não anonimizado e com acesso ativo, abre `withTenant({ tenantId, role: 'paciente', patientId, semConta: true })` e roda **apenas** `count(*)`/`exists` por seção (`noApp` do registro): plano publicado e receitas sugeridas nele, avaliações, atendimentos, documentos, conteúdos da biblioteca (a política RESTRICTIVE aplica a audiência; `liberarReceitasDoPlano` **não** é chamada), envios de exame, registros do diário nos últimos 30 dias. Nenhuma coluna de conteúdo é selecionada; nenhum `auditRead`. O arquivo entra em `SEM_CONTA_PERMITIDOS` (`src/db/tenant.ts`), com revisão do `revisor-rls` |
| RN-282 | **IA** (D19). Nenhum módulo de `src/modules/ia/` seleciona colunas de `patient_cadastro` além de `nome_social`; o `nome_social`, quando houver, entra em `outrosNomes` do `AlvoDaMascara` no resumo, no rascunho, na leitura de laudo e no contexto da IA Nutri. Guarda: teste de fonte que falha se `src/modules/ia/**` referir outra coluna da tabela; `campos-enviados.test.ts` ganha os marcadores dos campos novos em `proibidos` |
| RN-283 | **Anonimização** (D18). Em `anonimizarVencidos`, depois do UPDATE de `patients` (`if (r.length)`), `delete from patient_cadastro where patient_id = …` no contexto `worker`. O gatilho `patient_cadastro_sem_apagar` só deixa apagar no contexto `worker` com `patients.anonimizado_em` não nulo (molde de `exam_submissions_sem_apagar`). No **bloqueio** (pedido de exclusão atendido) nada muda no cadastro |
| RN-284 | **Textos de interface** em pt-BR, numa constante (`MSG_CADASTRO`, `MSG_LISTA`, `MSG_FICHA`, `MSG_NO_APP`), e entram na tabela "Textos de interface" das histórias do MVP no fechamento |

---

## 7. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-260 | Desempenho | Início com p95 ≤ 800 ms (CS-263): as 8 seções em **uma** transação, uma consulta por seção (total por `count(*)` + os 3 últimos), só com os índices existentes (`anthropometry_paciente_data_idx`, `consultations_paciente_data_idx` e equivalentes); "No app" em duas transações (nutri e paciente). Se a medição pedir, as seções viram uma consulta só com subconsultas. Cenário "abrir a ficha" na pilha de carga (app com 2 vCPU, RNF-03 v1.14) |
| RNF-261 | Acessibilidade | WCAG 2.1 AA: axe sem violação no Início, Perfil, lista e `[id]/app`, em 1280 px e 360 px, claro e escuro; faixa de abas inteira a 1280 px (D12); seções em `<details>`/`<summary>` com o contador no texto; diálogo Adicionar com foco no título ao abrir e devolvido ao botão ao fechar; menu da linha com `aria-expanded` e nome acessível "Ações de {nome}"; formulário com `fieldset`/`legend` por seção; erros ligados ao campo (`aria-describedby`) e anunciados; alvos ≥ 44 px |
| RNF-262 | Privacidade em log | Nada do cadastro complementar em log ou Sentry (regra 3): os erros de validação logam só o nome do campo; o `sentry-filtro` (lista do que pode sair) não ganha nenhum campo novo. Teste que procura CPF, CEP e observação de teste no log capturado de um "Salvar" com erro |
| RNF-263 | Testes | (a) unitários de `cpf.ts` (válidos, inválidos, repetidos, com máscara), dos valores do formulário e do texto do "Cadastro incompleto"; (b) **paridade** do "No app": num cenário com conteúdo por etiqueta, documento cancelado, plano arquivado, envio cancelado e peso oculto, cada contagem de `noAppDoPaciente` é igual ao tamanho do que as funções do portal devolvem na sessão de paciente (`feedDeConteudos`, `documentosDoPaciente`, `planoDoPaciente`, `evolucaoParaPaciente`, `meusEnvios`, `jornadaDoPaciente`), e o número de itens com selo de cada seção bate com a contagem; (c) **chaves**: `ItemDaSecao`, `listarPacientes` e o cartão do Início devolvem só as chaves das RN-272/RN-277; (d) **cobertura de colunas**: um teste lista as colunas de `patients` e de `patient_cadastro` (`information_schema`) e falha se aparecer coluna sem decisão registrada (exportação, anonimização, IA) — quem fizer merge depois do Plano 17 inclui `lembretes_pausados_em`; (e) integração com Testcontainers: RLS (público e paciente não leem nem gravam a tabela; paciente lê só a própria linha), unicidade do CPF com duas conexões, gatilho de apagar, auditoria das escritas, anonimização apaga a linha, exportação traz os campos; (f) `listarPacientes` com abas, ordem, nome social e etiqueta; (g) E2E: cadastro com campos novos, lista (abas, ordem, arquivar), Início (seções, Adicionar), "No app"; ajuste de `e2e/pacientes.spec.ts` (`getByLabel` casa por substring: "Nome" × "Nome social", "Telefone" × "Telefone fixo" — usar `exact: true`), `e2e/painel-rotas.ts` e `e2e/acessibilidade-painel.spec.ts`; (h) `[id]/impressao.test.ts` com o cabeçalho novo e a linha de medidas fora da impressão |
| RNF-264 | Manutenção | Seções e "No app" em `src/modules/ficha/`; a página Início só itera o registro; um plano novo acrescenta um arquivo em `secoes/` e uma linha no `index.ts` (§11) |

---

## 8. Telas e textos

### 8.1 Lista de pacientes (`/painel/pacientes`)

```
Pacientes                                                         [Novo paciente]
[ Ativos ] [ Inativos ] [ Todos ]                                    Ver bloqueados
Buscar por nome ou e-mail [________]  Etiqueta [Todas ▾]  Ordenar por [Nome (A–Z) ▾]  [Filtrar]

Nome                         Idade    E-mail            Acesso ao app   Desde        Ações
Ana Souza                    35 anos  ana@ex.com        Ativo           03/02/2025   [Ações ▾]
Joana Silva                  41 anos  jo@ex.com         Pendente        11/11/2026   [Ações ▾]
  Nome de registro: João Silva
```

| Onde | Texto |
|---|---|
| Abas | "Ativos", "Inativos", "Todos"; link "Ver bloqueados" |
| Dica da aba Inativos | "Pacientes arquivados: sem acesso ao app e sem notificações. O prontuário continua guardado." |
| Título em bloqueados | "Bloqueados por pedido de exclusão (LGPD): só para consulta." + link "Voltar para a lista" |
| Ordem | "Ordenar por": "Nome (A–Z)", "Nome (Z–A)", "Mais recentes", "Mais antigos" |
| Colunas | "Nome", "Idade", "E-mail", "Acesso ao app" (era "Acesso ao portal"), "Desde", "Ações" |
| Vazio | "Nenhum paciente encontrado." (como hoje); aba Inativos sem busca: "Nenhum paciente arquivado." |
| Menu | "Ações de {nome}" (nome acessível); itens "Abrir ficha", "Editar cadastro", "Arquivar", "Reativar", "Pedir exclusão (LGPD)" |
| Confirmar arquivar | "Arquivar {nome}? O paciente perde o acesso ao app e deixa de receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar quando quiser." Botões "Arquivar" / "Voltar" |
| Confirmar reativar | "Reativar {nome}? O paciente volta para os ativos e recupera o acesso ao app. Se ele ainda não entrou no app, reenvie o convite em Perfil." Botões "Reativar" / "Voltar" |
| Resultado (`role="status"`) | "Paciente arquivado." / "Paciente reativado." |
| Manual guiado | `busca-pacientes`: "Ache um paciente pelo nome ou pelo e-mail. As abas separam ativos e arquivados; os bloqueados ficam em Ver bloqueados." · novo `acoes-paciente`: "Em Ações você abre a ficha, edita o cadastro, arquiva ou reativa o paciente sem sair da lista." |

### 8.2 Ficha: cabeçalho e abas

```
Pacientes
Joana Silva   [Peso oculto no app]
Nome de registro: João Silva
41 anos · Masculino · jo@ex.com
Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura 28,1%
[Início] [Perfil] [Antropometria] [Gasto energético] … [Histórico de acessos]
```

| Onde | Texto |
|---|---|
| Sem avaliação | "Sem avaliação antropométrica." |
| Selo | "Peso oculto no app" (só com a opção ligada) |
| Manual guiado | `cabecalho-paciente`: "Nome, idade, situação e as medidas da última avaliação, com a data. O selo mostra se o paciente está arquivado ou bloqueado." · `abas-prontuario`: "Início reúne o que já foi feito; Perfil guarda o cadastro. Cada parte do acompanhamento tem a sua aba." |

### 8.3 Aba Início (`/painel/pacientes/{id}`)

```
[+ Adicionar]

Resumo                                    No app do paciente
Aniversário: 17 de maio                   Acesso: ativo · último acesso em 14/11/2026
Paciente desde 03/02/2025                 Plano alimentar publicado
Plano alimentar publicado em 10/11/2026   2 documentos · 12 conteúdos
Acesso ao app: Ativo: o paciente já…      Ver detalhes
⚠ Cadastro incompleto: faltam estado civil e endereço. Completar no Perfil

Inteligência artificial  [Pedir resumo à IA]   (US-120, como hoje)

▾ Plano alimentar (2)                                         Ver todos
   Plano alimentar · 10/11/2026 · Publicado   [No app]
   Plano alimentar · 02/09/2026 · Arquivado
▾ Antropometria (5)                                           Ver todos
   Avaliação · 12/10/2026  [No app]  …
▸ Anamneses (0)   Nenhum registro ainda.
…
```

| Onde | Texto |
|---|---|
| Botão | "Adicionar" (ícone "+", nome acessível "Adicionar ao prontuário") |
| Diálogo | Título "Adicionar ao prontuário"; grupos "Avaliações" e "Prescrições"; dica "Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético."; "Fechar" |
| Itens do diálogo | "Anamnese", "Antropometria", "Gasto energético", "Exame", "Atendimento", "Plano alimentar", "Receita", "Parecer" |
| Cartão Resumo | "Resumo"; "Aniversário: {dia} de {mês}"; "Paciente desde {data}"; "Plano alimentar publicado em {data}" / "Nenhum plano publicado"; "Acesso ao app: {texto}" |
| Aviso | "Cadastro incompleto: faltam {itens}." + "Completar no Perfil" |
| Nomes dos itens faltantes | "data de nascimento", "sexo", "identidade de gênero", "estado civil", "nacionalidade", "naturalidade", "escolaridade", "ocupação", "endereço", "telefone" |
| Seção | "{Título} ({n})"; "Ver todos" (nome acessível "Ver todos: {Título}"); vazio "Nenhum registro ainda."; selo "No app" |
| Títulos das seções | "Plano alimentar", "Antropometria", "Gasto energético", "Anamneses", "Atendimentos", "Exames", "Exames enviados pelo paciente", "Documentos" |
| Peso oculto na seção Antropometria | "Peso e IMC ocultos no app." |
| Manual guiado | novo `adicionar-prontuario`: "Um botão só para registrar anamnese, medidas, exames, atendimentos e prescrições." · novo `secoes-inicio`: "Cada seção mostra quantos registros há e os três mais recentes. O selo No app marca o que o paciente vê no app." · novo `no-app-cartao`: "O que o paciente enxerga no app, contado com as mesmas regras do app." |

### 8.4 Aba Perfil (`/painel/pacientes/{id}/perfil`)

Seções, nesta ordem: **Dados gerais**, **Contato e endereço**, **Observação**, **Acesso ao app** e **Etiquetas**
(movida do Resumo, como está). Botão "Salvar cadastro" (como hoje). "Novo paciente" usa o mesmo formulário, sem
Acesso ao app (o convite sai ao salvar) e sem Etiquetas.

| Campo | Rótulo | Dica |
|---|---|---|
| nome | "Nome completo" | — |
| nome_social | "Nome social (opcional)" | "Preencha só a pedido do paciente. Aparece no painel junto do nome completo." |
| data_nascimento | "Data de nascimento" | — |
| sexo | como hoje | "Usado nas fórmulas." |
| identidade_genero | "Identidade de gênero (opcional)": "Mulher", "Homem", "Não binário", "Outra", "Prefere não informar" | "Como o paciente se identifica. As fórmulas usam o sexo biológico." |
| estado_civil | "Estado civil (opcional)": "Solteiro(a)", "Casado(a)", "União estável", "Separado(a)", "Divorciado(a)", "Viúvo(a)" | — |
| escolaridade | "Escolaridade (opcional)": "Sem escolaridade", "Ensino fundamental incompleto", "Ensino fundamental completo", "Ensino médio incompleto", "Ensino médio completo", "Ensino superior incompleto", "Ensino superior completo", "Pós-graduação" | — |
| ocupacao | "Ocupação (opcional)" | "Profissão ou atividade principal." |
| nacionalidade | "Nacionalidade (opcional)" | "Ex.: brasileira" |
| naturalidade | "Naturalidade (opcional)" | "Cidade e estado onde nasceu. Ex.: Campinas (SP)" |
| cpf | "CPF (opcional)" | "Serve para identificar o paciente sem engano e para recibos que você emitir. Não aparece na lista nem no app." |
| email | "E-mail" | como hoje |
| telefone | "Celular / WhatsApp (opcional)" | "Ex.: (11) 91234-5678. É por este número que saem os avisos de WhatsApp, se o paciente autorizar." |
| telefone_fixo | "Telefone fixo (opcional)" | "Ex.: (11) 3123-4567" |
| endereço | legenda "Endereço (opcional)": "CEP", "Rua", "Número", "Complemento", "Bairro", "Cidade", "Estado" ("Selecione") | — |
| observacao | "Observação (opcional)" | aviso da US-260 + contador "{n} de 1.000 caracteres" |

Textos de erro: os da tabela da US-260. Bloqueado: "Paciente bloqueado por pedido de exclusão: o prontuário é só
para consulta." (como hoje). Manual guiado: `cadastro-paciente` (novo): "O cadastro fica em seções. Só nome,
nascimento, sexo e e-mail são obrigatórios; o resto completa o registro da primeira consulta."

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
| Sem convite | "Ainda não entrou no app. Reenvie o convite em Perfil." |
| Arquivado | "Paciente arquivado: não vê nada no app até ser reativado." |
| Bloqueado | "Paciente bloqueado por pedido de exclusão: sem acesso ao app." |
| Nunca acessou | "Último acesso: nenhum ainda." |
| Sem push | "Notificações: desligadas em todos os aparelhos." |
| Plano | "Nenhum plano publicado." |
| Documentos desligados | a linha não aparece |
| IA Nutri | "Ligada para este paciente" / "Desligada" / a linha não aparece sem a IA Nutri ativada no consultório |

Cartão no Início: as linhas Acesso, Plano, Documentos e Conteúdos, mais "Ver detalhes". Os lembretes do Plano 17
entram como linha "Lembretes" registrada pelo próprio Plano 17 (§11).

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
-- patient_cadastro_colunas_fixas (BEFORE UPDATE): tenant_id e patient_id não mudam (42501)
-- patient_cadastro_sem_apagar (BEFORE DELETE): só app_current_role() = 'worker' com patients.anonimizado_em não nulo (42501)
```

- **Sem** `app_enable_staff_only` (é dado do titular, D3), **sem** `app_allow_publico`, **sem** `app_allow_paciente_escrita`.
- **Guardas** (`test/isolamento.test.ts`, só acrescentar no fim de cada lista, `sessoes-paralelas.md` §6): `FABRICAS`
  (fábrica com o paciente do teste), `SEM_DELETE`, `IMUTAVEIS` (comentário: "Plano 18: patient_cadastro_colunas_fixas
  recusa mudar tenant_id/patient_id com 42501 antes da RLS") e o filtro de `SO_APAGA.patients`, se a FK `NO ACTION`
  exigir. `rls-guard.ts` e `audit-guard.ts` não ganham entrada (tabela com RLS e gatilho comuns). Lista final com o
  `revisor-rls`.
- **Auditoria:** entidade `patients` ("Cadastro do paciente"): as escritas no cadastro complementar aparecem no
  Histórico de acessos como o resto do cadastro. O `audit_log` não guarda o conteúdo da linha.
- **Drizzle:** `src/db/schema/pacientes.ts` (tabela nova) e `src/db/schema/index.ts` (reexporta).
- **Fora do banco:** nada de estado do Início ou do "No app" é gravado; tudo é leitura.

### 9.2 O que muda em código existente (resumo)

| Arquivo | Mudança |
|---|---|
| `src/modules/pacientes/pacientes.ts` | `pacienteSchema` com os campos novos; `criarPaciente`/`atualizarPaciente` gravam `patient_cadastro` na mesma transação; `cadastroDoPaciente` (RN-268); `listarPacientes` com aba, ordem, `nome_social`, `created_at` e o ponto de extensão do local (D11) |
| `src/modules/pacientes/cpf.ts` (novo) | `normalizarCpf`, `cpfValido`, `formatarCpf` |
| `src/modules/ficha/` (novo) | `secoes/` (registro, RN-277/RN-278), `cabecalho.ts` (RN-275), `incompleto.ts` (RN-269), `no-app.ts` (RN-281) |
| `src/app/painel/pacientes/[id]/` | `abas.tsx` (RN-274), `layout.tsx` (cabeçalho), `page.tsx` (Início), `perfil/page.tsx` (novo), `app/page.tsx` (novo) |
| `src/app/painel/pacientes/` | `page.tsx` (lista), `paciente-form.tsx` e `valores.ts` (seções e campos), `actions.ts` (arquivar/reativar pela lista) |
| `src/modules/pacientes/lgpd.ts`, `exportacao-job.ts` | RN-283 e §10 |
| `src/modules/ia/*` | `nome_social` na máscara (RN-282) |
| `src/db/tenant.ts` | `SEM_CONTA_PERMITIDOS` + `src/modules/ficha/no-app.ts` |
| `src/modules/ajuda/conteudo.ts` | `data-guia` novos e textos da §8 |

---

## 10. LGPD

| Tema | Tratamento |
|---|---|
| Finalidade e base | Identificação do paciente no prontuário (Res. CFN 594/2017, art. 4º, § 1º, I) e contato; tutela da saúde (LGPD, art. 11, II, "f") e o termo aceito. O Termo 1.0 e o DPA 1.0 (cláusulas 2 e 5) já falam em "cadastro": na leitura das normas, os campos novos cabem sem versão nova — **a confirmar com o advogado (E-09)** |
| Minimização | Tudo opcional; CPF com a finalidade escrita junto do campo; sem etnia; sem busca de CEP externa; a lista e o Início não leem os valores (D20) |
| Transparência | Aviso junto da Observação (D3); a dica do CPF diz onde ele aparece |
| Acesso e portabilidade (art. 18, II e V) | O `dados.json` (escopos `titular` e `equipe`) ganha `paciente.cadastro`: `cpf` (formatado), `nomeSocial`, `identidadeDeGenero`, `estadoCivil`, `escolaridade` (os três com o **rótulo** que a tela mostra, art. 19, II), `ocupacao`, `nacionalidade`, `naturalidade`, `telefoneFixo` (formatado), `endereco` (`cep`, `rua`, `numero`, `complemento`, `bairro`, `cidade`, `uf`) e `observacao`; sem linha, `cadastro: null`. `montarDados` passa a ler `patient_cadastro` por inclusão explícita, com o comentário atualizado. O LEIA-ME da exportação cita o bloco novo |
| Bloqueio (pedido atendido) | O cadastro fica identificado, só para consulta, como o resto do prontuário (US-018). Apagar o CPF já no bloqueio é pergunta ao advogado (§14) |
| Anonimização | A linha de `patient_cadastro` é apagada (RN-283); `patients` continua com o UPDATE de hoje. Teste: depois de `anonimizarVencidos`, nenhuma linha do titular e o `audit_log` com o "excluir" de ator nulo |
| IA | Nada do cadastro complementar vai à IA; o nome social só serve para a máscara (RN-282). Sem mudança no texto da autorização (RN-109) |
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

Usos previstos (premissa P-6): **Plano 17** — linha "Lembretes" no "No app" (configurados, ligados pelo paciente,
pausados) e, se quiser, seção "Lembretes no app" com link para a aba Plano alimentar; **Plano 19** — itens novos do
plano alimentar ficam dentro da seção existente; **Plano 20** — seção "Financeiro" (com `auditRead` próprio, porque
o Plano 20 trata o lançamento com paciente como sensível); **Plano 23** — filtro de local em `listarPacientes`.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-260 | Conflito de migration com o Plano 17 (`0118`/`0119`) e de `drizzle/meta` | D22: gerar de novo no rebase, uma migration por vez na fila; a fundação (PR 1) não tem migration |
| R-261 | Conflito em `abas.tsx` e `layout.tsx` com os Planos 17, 19 e 20 | PR 1 de fundação cedo; os outros planos penduram seções (§11) em vez de mexer na página; em `ABAS`, só acrescentar antes de `historico` |
| R-262 | A 13ª aba corta a faixa a 1280 px (axe "incomplete") | D12: medir no PR 1; se cortar, rótulo "Histórico" |
| R-263 | Renomear "Resumo" e criar "Perfil" quebra E2E (`painel-rotas.ts`, `acessibilidade-painel.spec.ts`, `pacientes.spec.ts`) e o manual guiado | Ajustes listados em RNF-263 (g) e §8; o `getByLabel` com `exact: true` |
| R-264 | O "No app" divergir do portal se um módulo do portal mudar a regra | A contagem roda no contexto de paciente (o banco aplica as políticas) e o teste de paridade compara com as funções do portal |
| R-265 | Uso de `semConta` fora do fluxo de paciente sem login abre precedente | Só contagens, depois de conferida a sessão `nutri`; entrada nova em `SEM_CONTA_PERMITIDOS` com revisão do `revisor-rls`; o contexto de paciente vê **menos** que o da nutricionista |
| R-266 | O Plano 20 quer a aba "Financeiro" (14ª): não cabe a 1280 px | Registrado aqui; a decisão (seção no Início em vez de aba, ou o menu lateral do backlog) é do Plano 20 com a orquestradora |
| R-267 | Filtro de etiqueta na aba "Todos" grava até 500 linhas de "Etiquetas" por consulta | Comportamento de hoje, mantido por regra 8; um INSERT só por lista (`auditRead` com lista) |
| R-268 | O cabeçalho grava uma leitura de antropometria a cada execução do layout (carregamento completo e cada `revalidatePath(…, 'layout')`) | `cache()` por requisição; volume aceito (uma linha por ação, não por aba) |
| R-269 | Um campo novo (ou a coluna do Plano 17) esquecido na exportação, na anonimização ou na IA | Teste de cobertura de colunas (RNF-263 d) e guarda de fonte da IA (RN-282) |
| R-270 | Seções do Início pesam na ficha (8 consultas) com o app em 2 vCPU | RNF-260: uma transação, índices existentes, cenário na pilha de carga |

---

## 13. Conflitos com sessões paralelas

| Sessão | O que disputa com o Plano 18 | Combinado |
|---|---|---|
| **Plano 17** (`nutridebby-a`, `plano-17-lembretes-rotina`) | `drizzle/` (`0118`/`0119`), `src/db/schema/pacientes.ts` (coluna `lembretes_pausados_em` em `patients` e gatilho `paciente_colunas` refeito na `0119`), `lgpd.ts`, `exportacao-job.ts`, `exportacao.test.ts`, `lgpd.test.ts`, `test/isolamento.test.ts`, `scripts/e2e-seed.ts`, `src/modules/plataforma/audit.ts` | O Plano 18 **não** mexe em `patients` nem no gatilho (D1). A migration do 18 é gerada depois da do 17 entrar (D22). A tarefa de LGPD do 18 espera o merge do 17 ou faz rebase nele; o teste de cobertura de colunas inclui `lembretes_pausados_em` se o 17 entrar antes. Lembretes entram no "No app" pelo registro (§11), pelo plano que entrar depois |
| **Plano 19** (`nutridebby-b`, plano alimentar 2) | `src/app/painel/pacientes/[id]/plano-alimentar/*`, `src/modules/ajuda/conteudo.ts`, `e2e/painel-rotas.ts`, manual técnico | O Plano 18 só **lê** `meal_plans` (contagem e situação) e linka para a aba; não toca nas telas do plano |
| **Plano 20** (`nutridebby-c`, financeiro) | `abas.tsx`, `layout.tsx` (aba "Financeiro", PD-33), `lgpd.ts`, `exportacao-job.ts`, `test/isolamento.test.ts` | O Plano 18 não toca `atendimentos.ts`, `presenca.ts` nem a tela da consulta (crítica do Plano 20, item 18). PD-33 entra em cima da ficha do 18 (R-266, §11) |
| Todas | `src/db/schema/index.ts`, `src/db/tenant.ts`, CLAUDE.md (regras 2 e 8), `docs/manual-tecnico/*`, índice dos planos, backlog | Só acrescentar; quem entra depois resolve no rebase (`sessoes-paralelas.md`, §6) |

---

## 14. Perguntas pendentes (não travam a v1)

- **Advogado (E-09):** (1) apagar o CPF já no bloqueio (LGPD, arts. 16, I e 18, IV)? (2) o "cadastro" do Termo 1.0 e
  do DPA 1.0 cobre os campos novos sem versão nova? (3) se a etnia entrar um dia, qual a base do art. 11?
- **CRN-3:** (1) a ressalva "considerando as características de cada instituição" da Res. 594, art. 4º, § 1º, I alivia
  algum item no consultório? (2) um cadastro sem nenhum registro clínico pode ser apagado de vez?
- **Contador:** se o CPF for usado em recibo ou nota fiscal, qual o requisito.

---

## 15. Decisões do dono

### Respostas de 16/11/2026 ("aprovo todas as recomendações, pode seguir")

| Pergunta | Resposta | Onde |
|---|---|---|
| 1. Campos além do pedido | Pedido + nome social, gênero, nacionalidade, naturalidade e escolaridade, todos opcionais, sem etnia | D2 |
| 2. A Observação é de quem | Faz parte do cadastro e vai na cópia do titular, com aviso junto do campo; anotação só da equipe continua nas notas privadas | D3 |
| 3. CPF repetido | Não: único por consultório, opcional, com dígito verificador | D4 |
| 4. Navegação da ficha | Abas em cima; "Resumo" vira "Início" (Adicionar + seções com contador); cadastro na aba nova "Perfil"; menu lateral no backlog | D12 |
| 5. "O que está no app" | Cartão no Início + página de detalhe | D16 |
| 6. "Excluir" na lista | Leva ao pedido de exclusão LGPD existente; nada é apagado | D10 |

### Correções da crítica incorporadas (conferidas no código, `main` 5482450)

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
19. Planos 19, 20 e 23 penduram seções → premissa P-6, a confirmar.

---

## 16. Critérios de aceite do plano (resumo para o fechamento)

- [ ] `patient_cadastro` com RLS de tenant e de paciente, auditoria (`patients`), colunas fixas, DELETE só do worker com
      titular anonimizado; fora de `PUBLICO_LIBERADO`, `PACIENTE_ESCREVE` e `STAFF_ONLY`; guardas e isolamento verdes.
- [ ] Público e sessão de paciente não gravam o cadastro complementar; paciente lê só a própria linha (teste).
- [ ] CPF opcional, validado e único por consultório; nunca na lista, em URL, em log, em mensagem ou na IA (CS-262).
- [ ] Formulário em seções no Perfil e em "Novo paciente", com os rótulos e dicas da §8.4; agendamento público
      continua sem os campos novos.
- [ ] Lista com abas, "Ver bloqueados", ordenação, "Desde", nome social e menu por linha; arquivar pela lista apaga os
      convites pendentes e avisa; "Pedir exclusão (LGPD)" só leva à Privacidade.
- [ ] Abas "Início" e "Perfil"; faixa inteira a 1280 px no axe (com "Histórico" se preciso).
- [ ] Cabeçalho com a última antropometria e a data, uma leitura auditada por requisição, fora da impressão.
- [ ] Registro de seções com as 8 seções, contador, 3 últimos com rótulo genérico, selo "No app" e "Ver todos"; sem
      `auditRead`; teste das chaves.
- [ ] Botão "Adicionar" com os grupos e a dica; sem Receita/Parecer quando os documentos estão desligados; ausente para
      bloqueado.
- [ ] "No app do paciente" (cartão e página) com contagens no contexto de paciente; teste de paridade verde (CS-261).
- [ ] `dados.json` com `paciente.cadastro` nos dois escopos; anonimização apaga a linha; teste de cobertura de colunas.
- [ ] `nome_social` na máscara da IA; guarda de fonte e `campos-enviados.test.ts` atualizados.
- [ ] Manual guiado (`data-guia` da §8), manual técnico (§2.5.4, §4.2, README), CLAUDE.md (regras 2 e 8,
      `patient_cadastro`), `SEM_CONTA_PERMITIDOS`, manual do usuário e Central de Ajuda atualizados.
- [ ] Pilha de carga com o cenário "abrir a ficha" dentro da meta (CS-263).

---

## 17. Referências

- Res. CFN 594/2017 (registro em prontuário), arts. 1º a 4º: https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm (conferida em 16/11/2026); Res. CFN 733/2022, art. 8º (só reescreve o art. 1º da 594).
- LGPD (redação compilada): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm — arts. 5º (II, XI, XIII), 6º (I, III, VI, VII), 11, 12, 16, 18, 19, 37 e 46.
- Código: `src/db/schema/pacientes.ts`, `src/modules/pacientes/{pacientes,lgpd,exportacao-job,convite-paciente,telefone,base}.ts`, `src/modules/agenda/agendamento-publico.ts`, `src/db/rls-guard.ts`, `src/db/tenant.ts`, `src/db/sem-conta-guarda.test.ts`, `src/modules/ia/{pseudonimizar.ts,campos-enviados.test.ts}`, `src/app/painel/pacientes/**`, `drizzle/0007_auditoria_funcoes.sql`, `drizzle/0051_rls_consultas.sql`, `drizzle/0085_paciente_colunas.sql`.
- Next.js desta versão: pastas sem `page.tsx` não viram rota; pastas privadas `_nome` (`node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`, "Private folders") — o registro fica em `src/modules/ficha/`, fora de `src/app`.
- Plano 17: `nutridebby-a/docs/superpowers/specs/2026-11-13-nutridebby-lembretes-de-rotina-design.md` e `…/plans/2026-11-13-nutridebby-17-lembretes-rotina.md`.
- Sessões paralelas: `docs/operacao/sessoes-paralelas.md` (branch `docs/sessoes-paralelas`), §§5–7.
