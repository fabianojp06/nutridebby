# Manual do usuário e Central de Ajuda — Plano 18 (ficha e cadastro do paciente)

Texto pronto para quem orquestra aplicar no documento "NutriDebby — Manual do sistema" (Claude Docs) e na Central de
Ajuda (artefato HTML publicado em 15/10/2026). O guardião não edita o documento nem publica a Central. Conferido contra o
branch local `plano-18-pr2` em `3799409` (17/11/2026): o PR 1 (abas Início e Perfil, cabeçalho, seções, Adicionar) está
em produção desde o PR #52; o **PR 2** (cadastro em seções, CPF, nome social, lista nova, "Cadastro incompleto" e "No app
do paciente") **ainda não está no ar** — aplicar a Parte 2 só depois do merge dele, conferindo se algum texto de tela
mudou na revisão final. Os textos entre aspas são os da tela, copiados do código. A linha "Fonte" de cada bloco serve
para conferir e **não vai para o manual**.

**Avisos (pôr no topo da seção indicada):**

- **Pacientes e ficha:** os prints de "Pacientes", do "Resumo" do paciente e do formulário de cadastro ficaram velhos (a
  página do paciente agora abre na aba **Início**; o cadastro foi para a aba **Perfil**; a lista ganhou abas). Trocar
  os prints depois do merge do PR 2.
- **Manual guiado:** quem já viu o tour de "Pacientes" e o do "Início do paciente" vê de novo o aviso "Primeira vez
  aqui?" (guias `pacientes` e `inicio-paciente` na versão 2); o Perfil ganhou guia próprio ("Perfil do paciente").

---

## Parte 1 — Já no ar (PR 1, em produção desde 17/11/2026)

### 1.1 A ficha do paciente em abas (Início e Perfil)

> Onde entra: aba da nutricionista, capítulo do prontuário. Substitui a descrição da página "Resumo" do paciente.
> Fonte: `src/app/painel/pacientes/[id]/abas.tsx`, `layout.tsx`, `page.tsx`, `perfil/page.tsx`; `src/modules/ficha/textos.ts`.

Ao abrir um paciente, a ficha abre na aba **Início**. As abas, nesta ordem: **Início**, **Perfil**, Antropometria, Gasto
energético, Anamnese, Atendimentos, Exames, Evolução, Privacidade, Plano alimentar, Documentos (só quando os documentos
assinados estão liberados no consultório), IA Nutri (quando a IA Nutri está ativada) e **Histórico** (o antigo
"Histórico de acessos").

- **Início** reúne o que já foi feito: o botão **Adicionar**, o cartão **Resumo** e as seções do prontuário.
- **Perfil** guarda o cadastro, o **Acesso ao app** (antes "Acesso ao portal", com o "Reenviar convite") e as
  **Etiquetas**.

No topo da ficha, debaixo do nome, aparece a **última avaliação**: "Última avaliação em {data}: altura 1,65 m · peso 72,4
kg · IMC 26,6 · gordura 28,1%" (ou "Sem avaliação antropométrica."). Com "Não mostrar peso no app" ligado, aparece o selo
"Peso oculto no app" — o painel continua mostrando o peso para você. Essa linha de medidas não sai na impressão.

### 1.2 O botão Adicionar

> Onde entra: logo depois de 1.1. Fonte: `src/app/painel/pacientes/[id]/inicio/adicionar.tsx`; `MSG_FICHA`.

No Início, **Adicionar** abre a janela "Adicionar ao prontuário", com a dica "Antes do plano alimentar, registre a
anamnese, a antropometria e o gasto energético.":

- **Avaliações:** Anamnese, Antropometria, Gasto energético, Exame, Atendimento.
- **Prescrições:** Plano alimentar e, com os documentos liberados, Receita e Parecer nutricional.

Cada item leva direto ao formulário da aba certa. Paciente bloqueado por pedido de exclusão não tem o botão: o prontuário
é só para consulta.

### 1.3 As seções do Início

> Onde entra: depois de 1.2. Fonte: `src/app/painel/pacientes/[id]/inicio/secao.tsx`; `src/modules/ficha/secoes/`.

Cada seção mostra quantos registros há e os três mais recentes — "Plano alimentar (2)", "Antropometria (5)",
"Gasto energético", "Anamneses", "Atendimentos", "Exames", "Exames enviados pelo paciente" (quando o recebimento de exames
está ligado ou já houve envio) e "Documentos" (com os documentos liberados). Cada item mostra só o tipo, a data e a
situação (por exemplo, "Anamnese · 10/11/2026"), nunca o conteúdo; "Ver todos" abre a aba com a lista completa. Seção
vazia: "Nenhum registro ainda.".

---

## Parte 2 — Depois do merge do PR 2

### 2.1 Cadastro do paciente em seções

> Onde entra: substitui "Cadastrar paciente" e "Editar o cadastro" no capítulo de pacientes.
> Fonte: `src/app/painel/pacientes/paciente-form.tsx`, `novo/page.tsx`, `[id]/perfil/page.tsx`;
> `src/modules/pacientes/cadastro-textos.ts` (`MSG_CADASTRO`, listas).

O cadastro fica em seções, em **Novo paciente** (botão "Cadastrar paciente") e na aba **Perfil** (botão "Salvar
cadastro"). Só **nome completo, data de nascimento, sexo e e-mail** são obrigatórios; o resto completa o registro da
primeira consulta (Resolução CFN nº 594/2017).

**Dados gerais:** Nome completo; Nome social (opcional) — "Preencha só a pedido do paciente. Aparece no painel junto do
nome completo."; Data de nascimento; Sexo biológico (usado nas fórmulas); Identidade de gênero (opcional) — "Como o
paciente se identifica. As fórmulas usam o sexo biológico." (Mulher, Homem, Não binário, Outra, Prefere não informar);
Estado civil (opcional); Escolaridade (opcional); Ocupação (opcional); Nacionalidade (opcional); Naturalidade
(opcional); CPF (opcional) — "Para identificar o paciente sem engano. Não aparece na lista nem no app."

**Contato e endereço:** E-mail; Celular / WhatsApp (opcional), com a autorização de WhatsApp (e, em Novo paciente, o
convite por WhatsApp); Telefone fixo (opcional); Endereço (opcional): CEP, Rua, Número, Complemento, Bairro, Cidade,
Estado.

**Observação:** Observação (opcional), até 1.000 caracteres, com o aviso "O paciente pode receber uma cópia deste campo
se pedir os dados dele (LGPD). Para anotações só suas, use as notas privadas do atendimento."

No Perfil, depois do cadastro, ficam **Acesso ao app** e **Etiquetas**.

Perguntas comuns:

- **"Já existe um paciente com este CPF neste consultório."** O CPF é único no consultório. O link "Abrir o cadastro
  existente (abre em nova aba)" mostra o outro cadastro (não aparece se o outro paciente está bloqueado por pedido de
  exclusão). O que você digitou continua no campo.
- **"CPF inválido. Confira os números."** O sistema confere os dígitos verificadores.
- **"Revise os campos marcados."** aparece junto do botão quando algum campo tem erro; o cursor vai para o primeiro
  deles.
- O CPF só aparece no Perfil e na cópia dos dados (LGPD), tanto na que o paciente pede pelo app quanto na que você pede
  em Privacidade. Não aparece na lista, no Início, no app, nas mensagens nem no PDF do prontuário.
- O agendamento pela página pública continua pedindo só os dados de antes; o resto você completa no Perfil.

### 2.2 Nome social

> Onde entra: logo depois de 2.1. Fonte: `src/app/painel/pacientes/[id]/layout.tsx`, `privacidade/page.tsx`;
> `src/modules/pacientes/prontuario-pdf.tsx`; `MSG_FICHA.cabecalho`, `MSG_LGPD.confirmarNomeDeRegistro`.

Preencha o nome social só quando o paciente pedir. Com ele:

- a ficha mostra o nome social em destaque e, logo abaixo, "Nome de registro: {nome completo}";
- a lista de pacientes mostra só o nome social, e a busca acha pelos dois nomes;
- na **impressão** e no **PDF do prontuário**, o nome completo (civil) vem primeiro e "Nome social: …" logo depois, como
  pede a Resolução CFN nº 594/2017;
- para confirmar um pedido de exclusão (aba Privacidade), digite o **nome de registro**, que a própria tela mostra.

### 2.3 A lista de pacientes

> Onde entra: substitui a descrição da lista no capítulo de pacientes.
> Fonte: `src/app/painel/pacientes/page.tsx`, `menu-da-linha.tsx`, `textos.ts` (`MSG_LISTA`), `valores.ts`.

- **Abas:** "Ativos", "Inativos" e "Todos". Inativos são os arquivados: "Pacientes arquivados: sem acesso ao app e sem
  notificações. O prontuário continua guardado." O link **"Ver bloqueados"** mostra os bloqueados por pedido de exclusão
  (LGPD), só para consulta.
- **Buscar por nome ou e-mail**, **Etiqueta** e **Ordenar por** ("Nome (A–Z)", "Nome (Z–A)", "Mais recentes", "Mais
  antigos"); depois, "Filtrar".
- **Colunas:** Nome, Idade, E-mail, Acesso ao app ("Ativo", "Pendente", "Expirado", "Sem convite"), Desde (a data do
  cadastro) e Ações.
- **Ações** de cada linha: "Abrir ficha", "Editar cadastro", "Arquivar" (ou "Reativar") e "Pedir exclusão (LGPD)", que
  leva à aba Privacidade. Arquivar pede confirmação ("Arquivar {nome}? O paciente perde o acesso ao app e deixa de
  receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar
  quando quiser."); depois aparece "Paciente arquivado." e o paciente vai para Inativos. Reativar avisa: "Se ele ainda
  não entrou no app, reenvie o convite em Perfil."

### 2.4 Início: "Cadastro incompleto" e "No app do paciente"

> Onde entra: no capítulo do prontuário, depois de 1.3. Fonte: `src/app/painel/pacientes/[id]/page.tsx`,
> `inicio/cartao-no-app.tsx`; `src/modules/ficha/incompleto.ts`, `textos.ts`.

- No cartão **Resumo**, quando falta algum dado do cadastro, aparece a nota "Cadastro incompleto: faltam estado civil e
  endereço." (até três itens) ou "Cadastro incompleto: faltam 6 dados.", com o link **"Completar no Perfil"**. Conta:
  data de nascimento, sexo, identidade de gênero, estado civil, nacionalidade, naturalidade, escolaridade, ocupação,
  endereço e telefone (celular ou fixo). Nome social, CPF e observação não contam. Não aparece para paciente bloqueado.
- O cartão **"No app do paciente"** mostra o acesso ("Acesso: ativo · último acesso em 14/11/2026", o convite pendente
  ou vencido), se há plano publicado, os documentos (com os documentos liberados) e os conteúdos que o paciente vê.
  "Ver detalhes" abre a página completa (2.5).
- Nas seções, o selo **"No app"** marca os registros que o paciente vê no app. Com "Não mostrar peso no app", a seção
  Antropometria avisa "Peso e IMC ocultos no app.".

### 2.5 Página "No app do paciente"

> Onde entra: depois de 2.4. Fonte: `src/app/painel/pacientes/[id]/app/page.tsx`; `MSG_NO_APP`.

"O que {nome} vê hoje no app do consultório. As contagens seguem as mesmas regras do app." Uma linha por assunto:

- **Acesso:** "Ativo: o paciente já criou a senha." com o último acesso, ou "Ainda não entrou no app." com o convite
  ("Convite enviado por e-mail. Vale até …" ou "Convite expirado. Reenvie para o paciente conseguir entrar." e o link
  "Reenviar o convite no Perfil").
- **Notificações:** "Ativas em 2 aparelhos" ou desligadas; "WhatsApp autorizado" ou não.
- **Plano:** "Publicado em {data}", as receitas sugeridas e "Lista de compras disponível"; ou "Nenhum plano publicado.".
- **Lembretes:** quantos estão ligados, quantos o paciente desligou e se ele pausou todos.
- **Evolução:** quantas avaliações o paciente vê, se peso e IMC aparecem no app e se o % de gordura aparece.
- **Jornada** (atendimentos), **Documentos**, **Conteúdos** (na biblioteca), **Exames** (envios), **Diário** ("{n}
  registros nos últimos 30 dias") e **IA Nutri** ("Ligada para este paciente" ou "Desligada").

Paciente arquivado ou bloqueado: só a linha do acesso ("Paciente arquivado: não vê nada no app até ser reativado." ou
"Paciente bloqueado por pedido de exclusão: sem acesso ao app."). Sem conta no app ainda: o que você configurou, sem as
contagens.

### 2.6 Cópia dos dados (LGPD) e anonimização

> Onde entra: no capítulo de privacidade (LGPD), nas seções "Exportar dados" e "Anonimização".
> Fonte: `src/modules/pacientes/exportacao-job.ts`, `prontuario-pdf.tsx`, `lgpd.ts`.

- A cópia dos dados (`dados.json`, a pedido da nutricionista ou do próprio paciente) passa a trazer o cadastro
  complementar: CPF, nome social, identidade de gênero, estado civil, escolaridade, ocupação, nacionalidade,
  naturalidade, telefone fixo, endereço e observação.
- O PDF do prontuário traz a identificação completa (nome civil, nome social, nascimento, sexo, identidade de gênero,
  estado civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço e telefones), sem o CPF e sem a
  observação.
- O pedido de exclusão atendido não apaga o cadastro: ele fica guardado com o prontuário até a anonimização, que apaga
  todo o cadastro complementar.

---

## Parte 3 — Central de Ajuda (artigos novos ou trocados)

> Fonte: os mesmos arquivos acima e `src/modules/ajuda/conteudo.ts` (guias `pacientes` v2, `inicio-paciente` v2,
> `perfil-paciente` v1). Cada artigo em até cinco parágrafos curtos, como os demais da Central.

1. **"Como cadastrar um paciente"** (trocar o artigo atual): os quatro campos obrigatórios; as três seções; o convite
   por e-mail ao salvar; "Cadastro do paciente: o cadastro fica em seções. Só nome, nascimento, sexo e e-mail são
   obrigatórios; o resto completa o registro da primeira consulta." (o passo do tour).
2. **"CPF do paciente"** (novo): opcional, conferido, único no consultório; onde aparece e onde nunca aparece; a
   mensagem de CPF repetido e o link "Abrir o cadastro existente (abre em nova aba)".
3. **"Nome social"** (novo): só a pedido do paciente; tela × impressão (nome civil primeiro no papel); busca pelos dois;
   confirmação da exclusão pelo nome de registro.
4. **"A lista de pacientes"** (trocar): abas Ativos/Inativos/Todos, "Ver bloqueados", ordenar, a coluna "Desde" e o menu
   "Ações" (arquivar e reativar sem sair da lista).
5. **"A aba Início do paciente"** (novo; PR 1 já no ar): Adicionar, Resumo, seções, a nota "Cadastro incompleto" e o selo
   "No app".
6. **"O que o paciente vê no app"** (novo): o cartão e a página "No app do paciente", linha a linha, e por que arquivado
   e bloqueado só mostram o acesso.
7. **Perguntas frequentes** (acrescentar): "Por que o paciente aparece com outro nome na lista?" (nome social); "Por que
   não acho o paciente arquivado?" (aba Inativos); "Onde foi parar o cadastro?" (aba Perfil).
