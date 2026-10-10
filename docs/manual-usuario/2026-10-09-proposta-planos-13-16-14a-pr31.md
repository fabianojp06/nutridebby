# Manual do usuário — Planos 13, 16 e 14A, correção de 09/10/2026 e PR #31 (textos 1.0 da IA e prazo de guarda)

Texto pronto para quem orquestra aplicar no documento "NutriDebby — Manual do sistema" (Claude Docs). O guardião não edita
o documento. Conferido contra a `main` em `944cd71` (09/10/2026, merge do PR #31). Substitui a versão conferida contra
`23d41b5`. Os textos entre aspas são os da tela, copiados do código. A linha "Fonte" de cada bloco serve para conferir e
**não vai para o manual**.

**Avisos de disponibilidade (pôr no topo de cada seção indicada):**

- **Parecer, retificação e o resto da seção "Documentos assinados"**: só aparecem no consultório em que o administrador
  liberou os documentos assinados (o mesmo interruptor da receita; o parecer não tem interruptor próprio).
- **Inteligência artificial e autorização do paciente (Planos 11 e 14A)**: no ar desde 09/10/2026, com os textos na
  **versão 1.0** (autorização do paciente 1.0 e aditivo da nutricionista 1.0). A IA aparece em três passos, nesta ordem:
  (1) o **suporte libera** a IA para o consultório; (2) a **nutricionista aceita o aditivo 1.0** em Configurações ›
  Inteligência artificial (IA); (3) **cada paciente autoriza** (no app, pelo link do e-mail ou pelo termo em papel). Sem
  o passo 1, Configurações mostra "A IA ainda não foi liberada para o seu consultório.". Sem os passos 1 e 2, ou com o
  perfil profissional da nutricionista incompleto (nome completo, CRN e e-mail de contato), o paciente não pode autorizar
  no app; quem já tem algum registro (por exemplo, autorizou a versão provisória) continua vendo o bloco de IA em Eu ›
  Privacidade e pode retirar a autorização. O fornecedor em uso é a **Anthropic (Claude), nos Estados Unidos**; os textos
  1.0 dizem que a Anthropic guarda os dados enviados **por até 30 dias, para operar e proteger o serviço**, não os usa
  para treinar a IA e depois os apaga, **com exceções**: o conteúdo sinalizado pelos sistemas de segurança do fornecedor
  pode ficar guardado por até 2 anos e ser revisto por pessoas da equipe do fornecedor, e o que a lei exigir fica pelo
  tempo da lei (1.6.1). Não prometa ao paciente que tudo é apagado em 30 dias.
- **Exames no app**: continuam desligados até a nutricionista ligar o recebimento em Configurações (Plano 12).
- **Textos em rascunho**: os textos do parecer (declaração e ressalva) e do app novo do paciente (mural, manual guiado)
  esperam a revisão da Debby. Os textos da IA foram publicados como 1.0 sem a validação do advogado (decisão do dono em
  09/10/2026); se o advogado pedir mudança, sai uma versão nova, que pede de novo o aceite da nutricionista e a
  autorização de todos os pacientes. Se mudarem, este manual muda junto.

---

## Parte 1 — Seções novas ou alteradas

### 1.1 Capítulo "Receita" → passa a se chamar "Documentos assinados: receita e parecer"

> Onde entra: renomear o capítulo "Receita" (inserido no fechamento do Plano 10A) e acrescentar as seções 1.1.1 a 1.1.7
> depois de "Cancelar uma receita". Trocar "receita" por "documento" nos títulos genéricos ("Preparar para assinatura",
> "Assinar à mão…", "Entrega ao paciente", "Verificação pública"), porque valem para os dois tipos.
> Fonte: `src/app/painel/pacientes/[id]/documentos/page.tsx`, `[docId]/page.tsx`, `[docId]/parecer-form.tsx`,
> `[docId]/motivo-retificacao.tsx`, `[docId]/cancelar.tsx`, `src/modules/documentos/constantes.ts`, `parecer.ts`,
> `cancelamento.ts`, `portal.ts`, `verificacao.ts`, `src/app/painel/configuracoes/perfil/page.tsx`, `documentos-form.tsx`.

Texto de abertura novo do capítulo:

> Na aba **Documentos** do prontuário você monta dois tipos de documento assinado: a **receita** de suplementos e
> fitoterápicos e o **parecer nutricional** sobre os exames do paciente. Os dois seguem o mesmo caminho: rascunho,
> preparo do PDF, assinatura à mão (fotos das páginas com o código da verificação em duas etapas), entrega ao paciente e
> verificação pública pelo código. Depois de assinado, um documento não muda mais: para corrigir, você faz uma
> **retificação** (uma versão nova).

**Ajuste na seção "Dados para documentos"** (os dados agora saem também no parecer):

| Trecho atual | Texto novo |
|---|---|
| "O nome completo, o CRN e o contato saem no carimbo das receitas (Resolução CFN nº 656/2020). O CRN e o endereço ficam no formulário acima." | "O nome completo, o CRN e o contato saem no carimbo das receitas (Resolução CFN nº 656/2020) e dos pareceres (Resolução CFN nº 760/2023, art. 10, I). O CRN e o endereço ficam no formulário acima." |
| **Nome completo** ("Sai no carimbo das receitas, como no seu registro no CRN.") | **Nome completo** ("Sai no carimbo das receitas e dos pareceres, como no seu registro no CRN.") |

#### 1.1.1 A lista de documentos

No prontuário, aba **Documentos**, ficam dois botões: **"Nova receita"** e **"Novo parecer nutricional"** (os dois somem
com o paciente bloqueado por pedido de exclusão).

A lista tem as colunas "Documento", "Data" e "Situação". O nome do documento é "Receita de dd/mm/aaaa" ou "Parecer
nutricional de dd/mm/aaaa"; a partir da segunda versão, ganha " · Versão 2", " · Versão 3" e assim por diante.

Situações possíveis: "Rascunho", "Preparando o PDF", "Aguardando assinatura", "Assinado", **"Substituído"** (nova) e
"Cancelado". Sem documentos: "Nenhum documento ainda.".

#### 1.1.2 Parecer nutricional: escrever

O parecer usa os exames que já estão na aba **Exames** do paciente. Lance os exames antes.

1. Na aba **Documentos**, clique em **"Novo parecer nutricional"**. Abre o rascunho.
2. Em **"Exames considerados"**, marque os exames que o parecer vai avaliar (até 20; ao chegar a 20, os outros ficam
   desabilitados). Embaixo de cada exame marcado aparecem os valores que ele tem hoje no prontuário. Exame sem valores
   lançados aparece com "(laudo no prontuário, sem valores lançados)". Sem nenhum exame: "Nenhum exame lançado. Lance os
   exames na aba Exames.".
3. Escreva a **"Avaliação nutricional"** (até 5000 caracteres).
4. Se quiser, preencha **"Conduta e orientações (opcional)"** (até 5000) e **"Encaminhamentos (opcional)"** (até 1000).
5. Clique em **"Salvar rascunho"**. Deve aparecer "Rascunho salvo.".

O rascunho pode ficar incompleto (sem exame ou sem avaliação). A cobrança vem só no preparo.

**O parecer guarda uma cópia dos valores.** A cada "Salvar rascunho" (e de novo no preparo), o sistema copia os valores
dos exames marcados. O laudo (o arquivo do exame) nunca vai para o parecer: só o nome, a data e os valores.

**Se um exame marcado for excluído** antes do preparo, o editor avisa "Um dos exames selecionados foi excluído. Revise a
seleção." e o exame deixa de ficar marcado.

#### 1.1.3 Parecer nutricional: preparar e assinar

1. No fim do editor, em **"Declaração"**, marque: "Declaro que este parecer não afirma diagnóstico de doença nem
   prescreve medicamento."
2. Clique em **"Preparar para assinatura"**. O sistema confere tudo e gera o PDF em alguns segundos.
3. O resto é igual à receita: **"Baixar PDF para assinar"**, imprimir, assinar à mão e enviar as fotos das páginas com o
   código da verificação em duas etapas (veja "Assinar à mão e enviar as fotos").

Mensagens do preparo:

| Mensagem | O que fazer |
|---|---|
| "Selecione ao menos um exame." | Marque pelo menos um exame. |
| "Escreva a avaliação nutricional (até 5000 caracteres)." | Preencha a avaliação (ou encurte). |
| "Use no máximo 5000 caracteres." / "Use no máximo 1000 caracteres." | Encurte "Conduta e orientações" / "Encaminhamentos". |
| "Um dos exames selecionados foi excluído. Revise a seleção." | Desmarque o exame excluído e salve de novo. |
| "Confirme a declaração para continuar." | Marque a declaração. |
| Aviso de perfil incompleto, com o link **"Completar perfil"** | Preencha os Dados para documentos em Configurações. |

**O que sai no PDF do parecer:** o título "Parecer nutricional", o carimbo, "Exames considerados" (cada exame como
"{nome} — dd/mm/aaaa" e uma tabela "Marcador · Valor · Unidade · Referência"), "Avaliação nutricional", "Conduta e
orientações" e "Encaminhamentos" (só se preenchidos) e, no fim, a frase fixa: "Este parecer trata do estado nutricional e
não constitui diagnóstico de doença nem substitui avaliação médica." O PDF não diz quais valores foram lidos com IA nem
quais exames o paciente enviou pelo app.

**Depois do preparo**, a tela mostra os cartões "Exames considerados" (a cópia congelada) e "Avaliação nutricional". Se um
exame mudar depois, aparece embaixo dele:
- "Os valores deste exame mudaram depois do parecer."
- "O exame {nome — data} foi excluído depois do parecer."

O parecer **não muda** com isso: continua com a cópia. Se o parecer precisar refletir o exame novo, faça uma retificação
(1.1.4).

#### 1.1.4 Retificar um documento assinado (receita ou parecer)

Use quando um documento assinado tem um erro ou precisa ser atualizado. A versão nova substitui a anterior **só quando for
assinada**; até lá, a anterior continua valendo.

1. Abra o documento assinado. No cartão **"Documento assinado"**, clique em **"Retificar"**.
2. Abre a versão nova em rascunho, já com o conteúdo da anterior. No topo aparece "Versão 2 — substitui o documento
   XXXX-XXXX-XXXX" (o código da anterior).
3. Preencha **"Motivo da retificação"** (até 500 caracteres; dica: "Fica só no prontuário."). O paciente não vê o motivo.
4. Corrija o que precisar e clique em **"Salvar rascunho"**.
5. Marque a declaração e clique em **"Preparar para assinatura"**. Sem motivo, aparece "Escreva o motivo da retificação
   (até 500 caracteres)."
6. Assine como sempre. Na hora em que a versão nova fica assinada, a anterior passa a **"Substituído"**.

Detalhes:
- Só uma retificação por vez. Clicar em "Retificar" de novo abre a mesma versão em andamento.
- Desistiu? Na versão nova (ainda rascunho), clique em **"Apagar rascunho"**. A anterior continua valendo.
- Na receita, a versão nova traz a justificativa de uso da anterior; a habilitação em Fitoterapia é conferida de novo.
- Fora do rascunho, a tela da versão nova mostra "Motivo da retificação (só no prontuário): …".
- O paciente recebe só o aviso do documento novo (o mesmo e-mail e a mesma notificação de qualquer documento assinado).
  O e-mail não diz que a anterior deixou de valer; o app e a verificação mostram isso.

#### 1.1.5 Documento substituído e histórico das versões

- Na lista, cada versão aparece numa linha própria ("… · Versão 2").
- A versão antiga mostra o cartão **"Documento substituído"**: "Substituído em dd/mm/aaaa pela versão N.", o link
  **"Abrir a versão N"** e o PDF assinado. Ela não tem mais "Retificar" nem "Cancelar documento".
- A versão nova diz no topo qual código ela substitui.
- Tudo o que acontece com os documentos (abrir, criar, preparar, assinar, entregar, cancelar, retificar) fica no
  **"Histórico de acessos"** do paciente como "Documentos assinados".

#### 1.1.6 Cancelar um documento (mudança)

> Onde entra: acrescentar ao fim da seção "Cancelar uma receita" (renomear para "Cancelar um documento").

O cancelamento vale para a receita e para o parecer ("Motivo do cancelamento", dica "Fica só no prontuário.", botão
**"Cancelar documento"**, confirmação "O documento deixa de valer para o paciente e na verificação pública. Esta ação não
pode ser desfeita.").

Novo: com uma retificação em andamento, o cancelamento é recusado com "Há uma retificação em andamento (versão N).
Conclua ou apague a retificação antes de cancelar." O botão continua na tela; a recusa aparece depois da confirmação.
Assine ou apague a retificação e tente de novo.

#### 1.1.7 O que o paciente e a verificação mostram

**No app (Eu › Meus documentos):** cada documento aparece como "Receita · dd/mm/aaaa" ou "Parecer nutricional ·
dd/mm/aaaa", com " · Versão 2" a partir da segunda. A versão antiga mostra "Substituído por uma versão mais nova.". O
resto é igual à receita: "Abrir PDF" e "Confirmo que recebi este documento".

**Pelo link do e-mail** (paciente sem app): a página "Abrir documento" mostra o mesmo título com a versão. O link de uma
versão substituída abre como indisponível.

**Verificação pública (/v):** passa a mostrar "Tipo: Parecer nutricional" (ou Receita). Uma versão substituída mostra
"Documento substituído — Este documento foi substituído por uma versão retificada em dd/mm/aaaa. Peça a versão atual a
quem o emitiu." Nada do conteúdo do parecer aparece na verificação.

#### 1.1.8 Privacidade dos documentos (mudança)

> Onde entra: substituir o texto da seção "Privacidade" do capítulo.

- **Cópia dos dados (ZIP)**: traz as receitas e os pareceres assinados, em PDF, na pasta `documentos/`, com a versão e o
  código da versão anterior. No parecer, entram os exames considerados, os valores, a avaliação, a conduta e os
  encaminhamentos, e a marca de quais valores foram lidos com IA e quais exames o paciente enviou pelo app.
- A **cópia do paciente** (pedida no app ou atendida pela nutricionista para o titular) traz só os documentos emitidos
  (assinados, substituídos ou cancelados). Nunca traz o **motivo da retificação** nem o motivo do cancelamento.
- A **cópia da equipe** traz também o motivo da retificação (o do cancelamento nunca sai).
- **Bloqueio e anonimização**: valem para todas as versões, como na receita.

---

### 1.2 Capítulo "Administração" — reescrita

> Onde entra: substitui a descrição da tabela "Contas de nutricionista", a tabela de ações e o painel de backup e disco do
> capítulo "Administração". Fonte: `src/app/admin/layout.tsx`, `navegacao.ts`, `page.tsx`, `contas/[id]/page.tsx`,
> `contas/nova/page.tsx`, `servidor/page.tsx`, `seguranca/page.tsx`, `painel-infra.tsx`, `convite.tsx`, `cota-form.tsx`,
> `ia-cota-form.tsx`, `metricas-form.tsx`, `reiniciar-2fa-form.tsx`.

A administração tem um cabeçalho "NutriDebby · Administração" com três abas — **"Contas"**, **"Servidor"** e
**"Segurança"** — e o botão **"Sair"**. A sessão do admin segue a regra da equipe (30 minutos sem uso, 8 horas de limite).

#### Aba Contas (a lista)

- No topo: "Contas", "Conectado como {e-mail}." e o botão **"Nova conta"**.
- Uma linha de resumo com o total de **todas** as contas: "N ativas · N suspensas · N convites pendentes", e o resumo do
  servidor ("Backup do banco: concluído em …", "Disco da VPS: N% usado") com o link **"Ver servidor"**.
- **Busca**: campo "Buscar por nome, endereço ou e-mail" e botão **"Buscar"**. O endereço é o da página pública (o
  final de /n/…). O e-mail pode ser de qualquer nutricionista do consultório. **"Limpar busca"** volta à lista inteira.
  Sem resultado: "Nenhuma conta encontrada.".
- **A lista** mostra 50 contas por página, das mais novas para as mais antigas, com as colunas "Conta" (nome, endereço e
  e-mail), "Situação" ("Ativa" ou "Suspensa"), "Convite" ("Aceito", "Pendente (até dd/mm/aaaa)", "Expirado" ou "Sem
  convite"), "Pacientes ativos", "Consultas no mês" e o botão **"Abrir"**. No celular, cada conta vira um cartão com as
  mesmas informações.
- Mais de 50 contas: links **"Anterior"** e **"Próxima"** embaixo.
- Depois de uma ação feita na página da conta, a lista volta à primeira página, sem a busca.

#### Página da conta (botão "Abrir")

Abre com **"Voltar para Contas"**, o nome do consultório, o endereço, o e-mail, o CRN, a situação e o convite. Embaixo,
cinco cartões:

| Cartão | O que tem |
|---|---|
| **"Uso no mês"** | "Consultas no mês", "App na semana" (pacientes com conta que abriram o app em 7 dias), "Faltas no mês", "WhatsApp no mês", "Armazenamento" (usado, cota e número de arquivos), "Exames do app" ("Enviados no mês: N" e "Aguardando revisão: N"), "Uso de IA no mês" (US$ gastos de US$ do limite) e "Tarefas de IA no mês" |
| **"Liberações"** | "Documentos assinados: Liberados/Bloqueados" com **"Liberar"** ou **"Bloquear"**, e "IA: liberada/bloqueada" (com "· ativada pela nutricionista") com **"Liberar"** ou **"Bloquear"** |
| **"Limites"** | "Cota mensal de WhatsApp" e "Limite de IA (US$/mês)", cada um com **"Salvar"** ("Salvo") |
| **"Métricas de sucesso"** | "Taxa de faltas antes do sistema (%)" e "Início do uso", com **"Salvar"** ("Métricas salvas.") |
| **"Conta"** | **"Reenviar convite"** (só sem convite aceito), **"Suspender"** ou **"Reativar"** |

As confirmações e mensagens das ações são as de antes, agora nesta página:
- Liberar documentos: "Liberar os documentos assinados para {consultório}? Confira antes a resposta do CRN-3, o termo e o
  backup." **Não bloquear depois do uso real** (a confirmação de bloquear explica o que o consultório perde).
- Liberar IA: "Liberar a IA para {consultório}? Só com a retenção configurada (zero, ou a de até 30 dias aceita na
  Anthropic direta), os textos 1.0 publicados, a avaliação aprovada e o backup no host (runbook da IA)." Com os textos
  1.0, a liberação é aceita em produção. (A recusa "Os textos legais da IA ainda são provisórios. …" só aparecia com os
  textos provisórios e não ocorre mais.)
- Bloquear IA: "Bloquear a IA de {consultório}? Novas leituras deixam de ser aceitas; o que está na fila falha sem envio."
- Suspender: "Suspender a conta {consultório}? A nutricionista e os pacientes perdem o acesso até a reativação. Nenhum
  dado é apagado." → "Conta suspensa. A nutricionista e os pacientes veem "Conta temporariamente indisponível"."
- Reativar: "Reativar a conta {consultório}?" → "Conta reativada."
- Reenviar convite: "Convite reenviado."

O admin nunca vê paciente, exame, envio ou arquivo: só contagens.

**Nova conta** (botão "Nova conta"): a página "Nova conta de nutricionista", com "Voltar". Ao criar, a lista mostra
"Conta criada. O convite foi enviado para o e-mail da nutricionista.".

#### Aba Servidor

O cartão **"Backup e disco"**: "Backup do banco: concluído em dd/mm/aaaa hh:mm (tamanho)", "Backup dos arquivos: …" e
"Disco da VPS: N% usado". Em vermelho: "FALHOU", ou o disco "(acima do limite de 70%)". Sem registro: "… nenhum backup
registrado".

#### Aba Segurança

O cartão **"Verificação em duas etapas"**: "Use quando alguém perdeu o app autenticador e os códigos de recuperação, ou
depois da troca do AUTH_SECRET. Confirme antes a identidade de quem pediu." Campos "E-mail da conta" e "Seu código da
verificação em duas etapas", botão **"Reiniciar verificação em duas etapas"** e a confirmação "Reiniciar a verificação em
duas etapas desta conta? O app autenticador e os códigos de recuperação dela deixam de valer, as sessões abertas caem e a
pessoa recebe um e-mail."

---

### 1.3 Capítulo "Portal do paciente" → "App do paciente" — reescrita

> Onde entra: substitui as seções do capítulo "Portal do paciente" listadas na Parte 2 (abas, Início, Plano, Diário,
> Evolução, Agenda, Perfil). Ficam como estão: "Primeiro acesso do paciente", "Paciente de mais de um consultório",
> "Novo aceite do termo", "Lista de compras", "Plano sem internet" (com o acréscimo de 1.3.10) e os textos de
> notificações (com o ajuste de 1.3.11). Fonte: `src/app/p/navegacao.ts`, `src/components/portal/*.tsx`,
> `src/components/portal/textos.ts`, `src/app/p/(portal)/**/page.tsx`, `src/modules/portal/mural-regras.ts`,
> `jornada-regras.ts`, `diario-constantes.ts`, `src/modules/ajuda/portal.ts`.

#### 1.3.1 Como o app está organizado

O app abre sempre em **Hoje**. No topo fica uma faixa na cor do consultório, com o logo, a frase "Acompanhamento com
{consultório}", o título da tela e as **cinco seções**:

| Seção | O que tem |
|---|---|
| **Hoje** | O mural do dia, o diário e a barra de atalhos |
| **Jornada** | Consultas, medidas, orientações de cada atendimento; "Todas as medidas" e "Minhas consultas" |
| **Plano** | O plano do dia, o PDF, a lista de compras e os conteúdos |
| **Exames** | Enviar um exame e acompanhar os enviados (só aparece se o consultório recebe exames pelo app ou se o paciente já enviou algum) |
| **Eu** | Conta, consultório, documentos, notificações, instalar o app, privacidade, "Como usar o app" e "Sair" |

As telas de dentro (por exemplo "Diário", "Todas as medidas", "Meus documentos") têm o botão **"Voltar"** no topo, que leva
de volta à seção de origem. Nenhum endereço mudou: links antigos e favoritos continuam funcionando.

#### 1.3.2 Hoje

O título é "Olá, {primeiro nome}", com a data do dia. Logo abaixo, um resumo da jornada (por exemplo "−2,4 kg desde
março", "3 consultas desde março" ou "Sua jornada começa na primeira consulta.", e "Próximo marco: consulta …" ou
"Nenhuma consulta marcada."). O resumo leva à Jornada.

**O mural** mostra o que importa no dia, em ordem de horário. Cada item diz quem é o autor, no próprio texto:
- **"Você"**: o que o paciente registrou no diário.
- **"Aviso do app"**: o que o sistema mostra (refeição, consulta, plano novo, conteúdo novo, documentos, exames).
- **"Sua nutricionista comentou seu registro ({refeição}, {dia} às {hora})"**: o comentário dela, com uma borda colorida.

Itens possíveis:

| Item | Texto | Botões |
|---|---|---|
| Refeição do plano (aparece 90 min antes do horário) | "Próxima refeição às {hora} — {refeição}: {resumo}." A primeira do dia começa com "Bom dia, {nome}." (ou Boa tarde/Boa noite) | **"Ver a refeição"** e **"Comi assim"** |
| Registro do diário | A refeição, a resposta e o texto/foto | **"Ver no diário"** |
| Comentário da nutricionista | O texto dela, como ela escreveu | **"Ver no diário"** |
| Consulta (próximos 7 dias) | "Sua próxima consulta: {quando} ({modalidade})." | **"Ver a consulta"** e **"Confirmar presença"** |
| Plano novo | "Seu novo plano alimentar está disponível." | **"Ver o plano"** |
| Conteúdo novo (até 3) | "Novo conteúdo: {título}" | **"Abrir"** |
| Documentos novos | "Você tem 1 documento novo." / "Você tem N documentos novos." | **"Ver documentos"** |
| Exame enviado | "{nome do exame}: {situação}" | **"Ver meus exames"** |

- Os dias anteriores (até 7 dias) ficam recolhidos em **"Dias anteriores"**.
- Sem plano publicado: "Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições aparecem aqui."
  Com plano e nada para agora: "Nada para agora. Suas refeições aparecem aqui perto do horário de cada uma."
- O link **"Ver todo o diário"** abre o diário completo.
- **O mural não é chat.** Não tem campo para escrever. O rodapé diz: "Seus registros do diário ficam visíveis para sua
  nutricionista, que pode comentar quando os ler. Este app não é um canal de conversa e não tem prazo de resposta. Dúvidas:
  anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192."

**Cartões do aparelho** (no topo do mural, até serem feitos neste celular): "Ative as notificações para saber quando
houver novidades." e "Instale o app na tela inicial.", cada um com o botão de ativar/instalar e **"Agora não"** (some por
30 dias).

**Barra "Ações"** (fixa embaixo, só em Hoje): **"Foto da refeição"** (abre o diário com o campo da foto), **"Enviar
exame"** (só se o consultório recebe exames pelo app) e **"Agendar"** (abre a marcação; com 3 consultas futuras, abre
"Minhas consultas", que explica o motivo).

#### 1.3.3 Responder à refeição: "Comi assim", "Comi outra coisa" e "Mandar foto do prato"

**"Comi assim"** registra no diário que o paciente comeu como no plano, sem escrever nada:
1. Toque em **"Comi assim"** (no mural ou na refeição aberta).
2. Aparece "Registrado no diário." com o botão **"Desfazer"** por **10 segundos**.
3. Tocou sem querer? Toque em **"Desfazer"**: aparece "Registro desfeito." e nada é gravado.
4. Passados os 10 segundos (ou ao sair da tela), o registro é gravado. O botão some do mural.

O prazo para enquanto o dedo, o mouse ou o foco do teclado estão sobre o aviso. Tocar duas vezes não cria dois registros.
Depois de gravado, não há como apagar (como qualquer registro do diário).

**"Comi outra coisa"** (na refeição aberta) abre o diário já com a refeição: "Refeição: {refeição · hora}", a pergunta
**"Como foi?"** com "Comi outra coisa" marcado, e os campos "O que você comeu?" e "Foto (opcional)". Precisa de texto ou
foto: sem os dois, "Escreva o que você comeu ou envie uma foto.". Toque em **"Registrar"**.

**"Mandar foto do prato"** (na refeição aberta) abre o mesmo formulário com o campo da foto.

Se a refeição já tiver resposta no dia, um texto ou foto mandado depois entra como registro comum, sem perder nada.

A nutricionista vê no painel, em **Diários**, "Comeu como no plano" ou "Comeu outra coisa" e "Refeição do plano: {refeição
· hora}".

#### 1.3.4 Diário

Abre por "Ver todo o diário" (Hoje), "Foto da refeição" (barra) ou pelas respostas da refeição. Título "Diário", com
"Voltar para Hoje". O formulário "Registrar refeição" e as regras (refeição, texto até 2000 caracteres, foto JPEG, PNG ou
HEIC até 10 MB, 10 registros por dia, "Registro salvo.") não mudaram. Cada registro mostra a refeição (ou a refeição do
plano), a data e a hora, a resposta ("Comi assim"/"Comi outra coisa"), o texto, a foto e o "Comentário da nutricionista".

#### 1.3.5 Jornada

O título é "Sua jornada desde {mês}" (com o ano, se a primeira consulta for de outro ano).
- **Gráfico**: "Peso nas consultas" (com 2 pesos ou mais). Sem 2 pesos, "Cintura nas consultas" (com 2 cinturas ou mais).
  Senão, sem gráfico.
- Botões **"Todas as medidas"**, **"Minhas consultas"** e **"Agendar consulta"** (este só se ainda pode marcar).
- **Linha do tempo**: a próxima consulta primeiro (com "Ver a consulta"), depois os atendimentos do mais novo ao mais
  antigo, cada um com as medidas daquela avaliação e o quadro **"Orientação da sua nutricionista"**. Avaliação sem
  atendimento aparece como "Medidas de dd/mm/aaaa". As notas privadas nunca aparecem.
- Sem nenhuma consulta: "Sua jornada começa na primeira consulta.".

**Todas as medidas** (botão da Jornada; "Voltar para Jornada"): a tabela de medidas por avaliação e um gráfico para cada
medida repetida. Peso, IMC e circunferências; % de gordura só se a nutricionista marcou "Mostrar % de gordura ao
paciente"; dobras cutâneas e exames nunca. Com menos de duas avaliações: "Registre mais uma avaliação para ver a
evolução". Sem nenhuma medida para mostrar: "Nenhuma medida para mostrar.".

As "Orientações recebidas" saíram daqui: agora ficam na Jornada, em cada atendimento.

#### 1.3.6 Plano

Título "Plano de hoje". Sem plano: "Sua nutricionista ainda está preparando seu plano".
- O nome do plano, "Total do dia: …" (só com calorias liberadas) e os botões **"Baixar PDF"**, **"Lista de compras"** e
  **"Conteúdos"** (a biblioteca de conteúdos mora aqui).
- As refeições em **sanfona** (toque para abrir), em ordem de horário; as sem horário ficam no fim. A próxima já vem aberta
  e destacada, com o selo "Próxima, daqui a {tempo}".
- Dentro de cada refeição: "Cerca de {n} kcal" (só com calorias liberadas), os alimentos com a quantidade à direita, as
  trocas na linha de baixo ("ou {alimento}, {quantidade}"), a "Observação da sua nutricionista", a "Sugestão de receita"
  (link) e os botões **"Mandar foto do prato"**, **"Comi assim"** e **"Comi outra coisa"**.
- **"Orientações do plano"** no fim.

**Refeição aberta** ("Ver a refeição", no mural): a tela da refeição, com o nome, o horário, o resumo e o mesmo conteúdo da
sanfona. Se a refeição já foi respondida hoje, no lugar de "Comi assim" aparece "No diário". "Voltar para Plano".

#### 1.3.7 Exames

A seção "Meus exames" (Plano 12) agora é uma das cinco seções do topo. O conteúdo é o mesmo: "Enviar exame" (só com o
recebimento ligado) e "Meus exames enviados". Veja também a correção de 09/10 (1.7).

#### 1.3.8 Eu (antes "Perfil")

Título "Eu". Partes, nesta ordem:
- **"Conta"**: "Conectado como {e-mail}.".
- **"Consultório"**: logo e nome; **"Trocar de nutricionista"** só para quem é paciente de mais de um consultório.
- **"Meus documentos"**: **"Ver meus documentos"** (só com os documentos liberados no consultório).
- **"Notificações"**: "Ativar notificações" e "Receber lembretes por WhatsApp" (como antes).
- **"Instalar o app"**: só quando o celular permite instalar.
- **"Privacidade"**: abre com "Algumas informações do acompanhamento podem não aparecer no app, a critério da sua
  nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados)." Depois, o bloco
  da IA (1.6.6, quando houver), **"Baixar meus dados"** e **"Pedir exclusão dos meus dados"** (como antes).
- **"Como usar o app"** (1.3.9).
- **"Sair"**, no fim da tela (antes ficava no topo).

#### 1.3.9 Manual guiado do app: "O app mudou" e "Como usar o app"

- Na primeira vez que abre Hoje depois da mudança, quem já usava o app vê **"O app mudou. Quer ver onde ficou cada
  coisa?"**. Quem entra pela primeira vez vê **"Boas-vindas ao app do seu acompanhamento. Quer ver como funciona?"**.
  O aviso aparece **uma vez por conta** (vale em todos os celulares e consultórios).
- **"Ver como funciona"** abre um passeio de 5 passos: "Seu acompanhamento" (a faixa do topo), "Hoje" (o mural),
  "Responder à refeição" ("Comi assim" e "Comi outra coisa"), "Atalhos" (a barra de baixo) e "Eu". **"Agora não"** fecha.
- Para ver de novo: **Eu › "Como usar o app"**. A página explica "Onde fica cada coisa" e "Perguntas comuns" e tem o link
  **"Ver o tour de novo"**.
- Os textos de ajuda não falam de peso.

#### 1.3.10 Sem internet (acréscimo à seção "Plano sem internet")

Sem internet, a cópia do plano abre também pela refeição ("Ver a refeição") e já mostra a refeição aberta. Os botões
"Comi assim", "Comi outra coisa" e "Mandar foto do prato" ficam desligados, com o aviso "Sem conexão. Registre quando
voltar.".

#### 1.3.11 Notificações e instalação (ajuste)

Onde o manual diz "No **Início** ou em **Perfil → Notificações**", passa a valer "No cartão de **Hoje** ou em **Eu →
Notificações**". Onde diz "no **Início** aparece o botão **Instalar app**", passa a valer "no cartão de **Hoje** ("Instale
o app na tela inicial.") ou em **Eu → Instalar o app**". As notificações e os textos delas não mudaram.

---

### 1.4 Capítulo "Pacientes", aba Evolução — seção nova "Não mostrar peso no app"

> Onde entra: no capítulo "Pacientes", na descrição da aba Evolução. Fonte:
> `src/app/painel/pacientes/[id]/evolucao/peso-oculto.tsx`, `src/modules/pacientes/peso-oculto.ts`,
> `src/modules/plataforma/audit.ts`.

Para pacientes que se sentem mal ao ver o peso, você pode tirar o peso do app dele.

1. No prontuário, abra a aba **Evolução**.
2. Na parte **"Peso no app do paciente"**, marque **"Não mostrar peso no app"**.
3. Clique em **"Salvar"**. Aparece "Peso oculto no app desde dd/mm/aaaa".

Texto de ajuda da tela: "O paciente não vê esta opção. O peso e o IMC deixam de aparecer no app. Continuam no prontuário,
nos documentos que você assina, no que você escreve (orientações e comentários aparecem como estão) e na cópia dos dados
que o paciente pedir (LGPD)."

No app, somem o peso e o IMC do resumo de Hoje, da Jornada (sem gráfico de peso nem de cintura) e de "Todas as medidas".
As circunferências e o % de gordura (se liberado) continuam. O app não diz ao paciente que o peso está oculto.

**Cuidado:** o que você escreve (orientação, comentário no diário) aparece como você escreveu. Se escrever o peso ali, o
paciente vê.

Para voltar a mostrar, desmarque e salve. Ligar e desligar fica no **"Histórico de acessos"** como "Peso oculto no app"
("Ligou" / "Desligou"). Com o paciente bloqueado ou anonimizado, a opção é só leitura.

---

### 1.5 Capítulo "Diários" (painel) — acréscimo

> Fonte: `src/app/painel/diarios/page.tsx`, `src/app/painel/diarios/[id]/page.tsx`.

Os registros feitos pelos botões da refeição aparecem com "Comeu como no plano" ou "Comeu outra coisa" e, no registro
aberto, "Refeição do plano: {refeição · hora}". Um "Comi assim" não tem texto nem foto: é só a marca.

---

### 1.6 Capítulo "Inteligência artificial" — seção nova "Autorização do paciente"

> Onde entra: no capítulo da IA (Plano 11), **substituindo** a parte "informar o paciente" (aviso por e-mail, entrega em
> mãos, recusa). Abrir com o aviso: **"No ar desde 09/10/2026, com os textos 1.0. Aparece no consultório depois que o
> suporte libera a IA e a nutricionista aceita o aditivo 1.0 em Configurações."** Fonte:
> `src/app/painel/pacientes/[id]/privacidade/uso-ia.tsx`, `pedido-ia-form.tsx`, `termo-ia/page.tsx`,
> `termo-ia/termo-papel-form.tsx`, `src/app/p/(portal)/perfil/page.tsx`, `privacidade.tsx`, `perfil/ia/page.tsx`,
> `src/app/autorizacao-ia/[token]/page.tsx`, `decisao-form.tsx`, `src/modules/ia/constantes.ts` (`MSG_AUTORIZACAO`,
> `CANAL_ROTULO`, `DESTINO_ROTULO`, `MSG_IA`), `src/modules/ia/textos-legais.ts` (`AUTORIZACAO_IA_VERSAO`,
> `IA_ADITIVO_VERSAO`, `RETENCAO_NA_AUTORIZACAO_1_0`, `RISCOS_A_MAIS_1_0`, `retencaoDoAditivo`), `src/modules/ia/modo.ts`
> (`estadoIaDoTenant`, `estadoIaComPaciente`), `src/modules/ia/autorizacao.ts` (`secaoIaVisivel`, `blocoIaDoApp`),
> `src/email/templates.tsx`, `src/app/painel/configuracoes/ia-secao.tsx`, `ia-ativar-form.tsx`,
> `src/app/painel/pacientes/[id]/exames/ia-exame.tsx` (`iaNoExame`).

#### 1.6.1 O que muda

Antes, bastava **informar** o paciente sobre a IA. Agora a IA só pode ser usada com os dados de um paciente depois que
**ele autorizar**, por escrito, num texto próprio ("Autorização para uso de inteligência artificial"). A autorização vale:
- só para a leitura de laudos (versão `1.0` do texto, "Versão 1.0, de 09/10/2026.");
- só para o destino em que foi dada. Hoje o destino é "Anthropic (Claude), Estados Unidos" (o sistema também conhece
  "Amazon Web Services (Claude), União Europeia", que não está em uso). Se o destino mudar, é preciso pedir de novo;
- só para este consultório.

**Quando a IA aparece.** Três passos, nesta ordem: o suporte libera a IA para o consultório; a nutricionista aceita o
aditivo 1.0 (1.6.9); o paciente autoriza (1.6.3 a 1.6.7). Antes do primeiro passo, Configurações mostra "A IA ainda não
foi liberada para o seu consultório.". Pedir a autorização (por e-mail, no papel) e o "Ler e decidir" do app só existem
depois dos dois primeiros e com o perfil profissional completo (veja o fim desta seção); quem já tem algum registro
continua vendo o bloco do app para retirar a autorização (1.6.6).

**O que o texto 1.0 diz ao paciente sobre o fornecedor** (parte "Para onde vai" e "Por quanto tempo"): os dados vão à
Anthropic, empresa dos Estados Unidos que fornece a IA (Claude); o processamento acontece **nos Estados Unidos**, país sem
decisão de adequação da ANPD, por isso o envio só acontece com a autorização específica; "O fornecedor não usa os dados
para treinar a IA. A Anthropic guarda os dados enviados por até 30 dias, para operar e proteger o serviço (por exemplo,
segurança e prevenção de abuso), e depois os apaga. Se os sistemas de segurança dele sinalizarem o conteúdo, ele pode
guardá-lo por até 2 anos; se a lei exigir, pelo tempo que a lei exigir." Nos riscos, o texto 1.0 acrescenta: "A Anthropic
é uma empresa dos Estados Unidos e guarda os seus dados lá por até 30 dias. As leis de lá permitem, em certas situações,
que autoridades americanas peçam acesso a esses dados. Se os sistemas de segurança do fornecedor sinalizarem o conteúdo,
ele pode ser revisto por pessoas da equipe do fornecedor." A sugestão da IA continua guardada no NutriDebby por até 7
dias.

**Quem autorizou numa versão anterior** (a provisória `0.1-provisorio`; em produção o suporte não conseguia liberar a IA
com ela) precisa autorizar de novo: a autorização antiga não vale para a 1.0 (1.6.2 e 1.6.6 mostram o que cada um vê). A
nutricionista que aceitou um aditivo anterior (`0.1-provisorio` ou `0.2-provisorio`) também aceita de novo (1.6.9).

Autorizar é opcional. Recusar ou retirar não muda nada no atendimento. O paciente pode autorizar de três formas: **no app**,
**pelo link do e-mail** ou **pelo termo em papel**.

A autorização só pode ser pedida com a IA ativa no consultório e com o perfil profissional completo (o texto cita o nome,
o CRN e o contato). Perfil incompleto: "Complete seu perfil profissional (nome completo, CRN e e-mail de contato) em
Configurações antes de pedir a autorização de IA.".

#### 1.6.2 Na aba Privacidade do paciente: "Uso de IA"

A parte **"Uso de IA"** mostra a situação:

| Situação | Texto |
|---|---|
| Nunca autorizou | "Ainda não autorizou." e "A IA só pode ser usada com os dados deste paciente depois que ele autorizar. Recusar não muda nada no atendimento." |
| Autorizou | "Autorizou em dd/mm/aaaa ({canal}, versão {versão})." (hoje "versão 1.0"). O canal é "app", "link por e-mail" ou "termo em papel". No papel, também **"Ver termo assinado"** |
| Retirou | "Retirou em dd/mm/aaaa." |
| Texto antigo (autorizou numa versão anterior à 1.0) | "Autorizou a versão {versão}, que não vale mais. Peça uma nova autorização." (por exemplo "Autorizou a versão 0.1-provisorio, que não vale mais. Peça uma nova autorização."). A IA fica recusada para esse paciente até a autorização nova; os botões de pedido continuam na tela |
| Destino mudou | "Autorizou o envio para {destino}. O destino mudou: peça uma nova autorização." |

Alerta: se a autorização veio pelo link logo depois de o e-mail do paciente mudar, aparece "Atenção: o e-mail do paciente
mudou pouco antes desta autorização. Confirme com ele que foi ele quem autorizou.".

Também na parte: **"Ver o texto da autorização"** (abre o texto completo), as ações de 1.6.3 a 1.6.5 e a lista
**"Registros"**, do mais novo ao mais antigo ("dd/mm/aaaa — Autorizou (link por e-mail, versão …)", "dd/mm/aaaa — Retirou
(app)", "dd/mm/aaaa — Pedido enviado por e-mail"). Com o paciente bloqueado ou anonimizado, tudo é só leitura.

Paciente com conta no app: aparece a dica "O paciente também pode autorizar no app, em Eu › Privacidade.".

#### 1.6.3 Pedir por e-mail

1. Em "Uso de IA", clique em **"Enviar pedido de autorização por e-mail"**.
2. Aparece "Pedido enviado. O link vale por 7 dias.".
3. O paciente recebe o e-mail "{consultório}: autorização para uso de inteligência artificial", com o botão **"Ler e
   decidir"**. O e-mail não traz dado de saúde.

Um pedido por vez: com um pedido válido, aparece "Já há um pedido por e-mail válido até dd/mm/aaaa. Aguarde a resposta do
paciente ou registre o termo em papel.". Sem e-mail no cadastro: "Cadastre o e-mail do paciente para enviar o pedido.".

#### 1.6.4 Termo em papel (código de referência)

Para o paciente que prefere assinar no papel:
1. Em "Uso de IA", clique em **"Registrar termo em papel"**.
2. Clique em **"Imprimir termo"**. **Imprima pelo Chrome ou pelo Edge**: só eles imprimem o rodapé "Código de referência:
   XXXX-XXXX-XXXX — Página x de y" em todas as páginas. O termo traz o texto, o "Nome do paciente", o código de referência,
   "Recebi uma via deste termo.", "Data: ____/____/______" e "Assinatura do paciente: ______________________".
3. O paciente lê, assina e data.
4. Fotografe ou digitalize **todas as páginas**, num arquivo só (JPEG, PNG ou PDF, até 20 MB).
5. Na mesma tela, em "Registrar termo em papel", preencha:
   - **"Código de referência impresso no termo assinado"** ("Digite o código que aparece no rodapé do termo assinado.");
   - **"Data da assinatura"**;
   - **"Foto ou PDF do termo assinado"** ("Fotografe ou digitalize todas as páginas do termo, num arquivo só.");
   - marque "Confirmo que o paciente assinou este termo, na versão {versão}, com envio para {destino}, e que o arquivo
     mostra todas as páginas e a assinatura."
6. Clique em **"Salvar"**. Volta para Privacidade com "Termo registrado. Entregue ao paciente uma via do termo assinado.".
7. Guarde o original em papel na pasta do paciente e entregue uma via a ele (a tela lembra: "Guarde o original em papel na
   pasta do paciente até a anonimização dele e entregue ao paciente uma via.").

Se o paciente tem e-mail, ele recebe o e-mail de confirmação (1.6.7).

| Mensagem | O que fazer |
|---|---|
| "Digite o código de referência impresso no termo assinado." | Digite o código do rodapé. |
| "O código não confere com o do termo atual. Se o código digitado está certo, o texto do termo mudou: imprima o termo de novo e peça uma nova assinatura." | Confira o código; se estiver certo, imprima de novo. |
| "Informe a data em que o paciente assinou o termo." | Preencha a data (não pode ser futura nem anterior à versão do texto). |
| "O paciente retirou a autorização depois desta data. Imprima o termo de novo e peça uma nova assinatura." | Um termo antigo não desfaz uma retirada. Peça nova assinatura. |
| "Envie a foto ou o PDF do termo assinado." / "Envie um arquivo JPEG, PNG ou PDF de até 20 MB." | Envie o arquivo certo. |
| "Confirme que o paciente assinou o termo." | Marque a confirmação. |

**"Ver termo assinado"** abre o arquivo; cada abertura fica no "Histórico de acessos" como "Autorização de IA".

#### 1.6.5 Registrar a retirada a pedido do paciente

Se o paciente pedir (pessoalmente, por telefone), clique em **"Registrar retirada a pedido do paciente"** e confirme
("Registrar que o paciente retirou a autorização? A IA deixa de ser usada com os dados dele na hora."). As leituras de IA
na fila e as sugestões ainda não usadas desse paciente são canceladas na hora; a leitura que já estiver em processamento é
barrada pelo sistema antes de sair para a IA ou, se já saiu, antes de a sugestão ser gravada. A retirada funciona sempre,
mesmo com a IA desligada.

A retirada vale daí em diante e não apaga o que já aconteceu: o que a IA sugeriu e a nutricionista já salvou continua no
prontuário (o texto diz ao paciente "O que já está no prontuário continua lá."), e o laudo já enviado segue a guarda do
fornecedor descrita nos textos 1.0 (até 30 dias; até 2 anos se sinalizado; o que a lei exigir, pelo tempo da lei — 1.6.1).

#### 1.6.6 O que o paciente vê no app (Eu › Privacidade)

Com a IA ativa no consultório (liberada pelo suporte, com o aditivo 1.0 aceito pela nutricionista e o perfil profissional
completo: nome completo, CRN e e-mail de contato) ou se o paciente já tiver algum registro, aparece em **Eu ›
Privacidade** o bloco **"Uso de inteligência artificial (IA)"**. Com o perfil incompleto e sem registro, o app não mostra
nada sobre IA, mesmo com a IA ativa:

- "Você ainda não autorizou." e o link **"Ler e decidir"**.
- "Ler e decidir" abre a tela "Uso de inteligência artificial (IA)" com o texto inteiro e dois botões:
  - **"Autorizo o envio para fora do Brasil"** → volta para Eu com "Autorização registrada. Você pode retirar quando
    quiser.";
  - **"Agora não"** → volta para Eu com "Tudo bem. Nada muda no seu atendimento." (nada é gravado).
- Depois de autorizar: "Você autorizou em dd/mm/aaaa (versão {versão})." e o botão **"Retirar autorização"**, com a
  confirmação "Retirar a autorização? A partir de agora, nenhum dado seu será enviado à IA. Isso não muda nada no seu
  atendimento." → "Autorização retirada.".
- Depois de retirar: "Você retirou a autorização em dd/mm/aaaa.".
- Se o texto ou o destino mudou (por exemplo, quem autorizou a versão provisória 0.1 antes da 1.0): "O texto da
  autorização mudou. Leia e decida de novo.", com **"Ler e decidir"** (que abre o texto 1.0) e **"Retirar autorização"**.
  Enquanto a nutricionista não aceitar o aditivo 1.0 (ou com o perfil profissional incompleto), só aparece "Retirar
  autorização".
- Depois da retirada pelo app (ou pelo link do e-mail), nenhum laudo dele sai para a IA; as leituras na fila e as
  sugestões ainda não usadas são canceladas logo em seguida (por uma tarefa de fundo, não no mesmo instante). O que já está no prontuário continua lá (1.6.5).

Quem é paciente de mais de um consultório decide em cada um, separadamente.

#### 1.6.7 Pelo link do e-mail (paciente sem app)

O botão "Ler e decidir" do e-mail abre uma página sem login, com o nome do consultório, o texto da autorização e, abaixo do
título, "Esta autorização é pessoal. Se você recebeu este e-mail por engano, não toque em Autorizo.". O paciente confirma
que não é robô e toca em **"Autorizo o envio para fora do Brasil"** ou **"Agora não"**.

- Autorizou: "Autorização registrada. Você pode retirar quando quiser, pelo link do e-mail de confirmação, pelo app ou
  pedindo à sua nutricionista." Chega o e-mail **"Você autorizou o uso de inteligência artificial"**, com o resumo, o
  destino ("Destino dos dados: Anthropic (Claude), Estados Unidos. Os seus dados saem do Brasil."), "Se não foi você quem autorizou, toque em Retirar a autorização e avise sua
  nutricionista." e o botão **"Retirar a autorização"**.
- Abrir o link de novo: "Você já autorizou em dd/mm/aaaa." com **"Retirar autorização"**.
- Link vencido: "Este link expirou. Peça um novo à sua nutricionista."; link sem valor: "Este link não é mais válido. Fale
  com sua nutricionista."; autorização que não vale mais: "Esta autorização já não está em vigor.".
- Outras mensagens: "Confirme que você não é um robô.", "Muitas tentativas. Tente de novo em alguns minutos.", "Tente
  novamente em alguns minutos", "O texto da autorização mudou. Recarregue a página e leia de novo.".

O link de retirada do e-mail de confirmação não vence enquanto aquela autorização for a decisão mais recente.

#### 1.6.8 Na aba Exames (mudança)

"Ler valores com IA" e, na fila de exames recebidos, "Aceitar e ler valores com IA" só aparecem com a autorização vigente.
Sem ela, a aba Exames mostra "Antes de usar a IA, peça a autorização do paciente (Privacidade > Uso de IA)." ou, se ele
retirou, "Este paciente retirou a autorização para o uso de IA.". A autorização de uma versão anterior à 1.0 conta como
"sem autorização".

Outros avisos da aba Exames (embaixo de cada exame com laudo) que dependem do consultório ou da plataforma: "A IA ainda
não foi liberada para o seu consultório." (o suporte não liberou ou bloqueou), "Para continuar usando a IA, aceite a versão atual do aditivo de
inteligência artificial." (a nutricionista ainda não aceitou o aditivo 1.0) e "A IA está indisponível no momento. Você pode
continuar sem ela." (a IA foi desligada na plataforma, por emergência ou porque a guarda do fornecedor não está
configurada). Com a IA liberada pelo suporte e ainda não ativada pela nutricionista, a aba Exames não mostra nada sobre
IA.

#### 1.6.9 Configurações › Inteligência artificial (IA): aditivo 1.0

A seção **"Inteligência artificial (IA)"** mostra o aditivo "Aditivo de inteligência artificial ao contrato de tratamento
de dados (versão 1.0)" (toque para abrir o texto). O texto 1.0 traz o fornecedor e o país em uso ("Anthropic (Claude), com
processamento nos Estados Unidos"; "A Anthropic atua como suboperadora da OPERADORA, além das listadas no DPA.") e, na
cláusula 6, a guarda: "O fornecedor não usa o conteúdo para treinar modelos. A Anthropic guarda o conteúdo enviado por
até 30 dias, para operar e proteger o serviço (por exemplo, segurança e prevenção de abuso), e depois o apaga. Se os
sistemas de segurança dela sinalizarem o conteúdo, ela pode guardá-lo por até 2 anos; se a lei exigir, pelo tempo que a lei
exigir. …". Termina com "Versão 1.0, de 09/10/2026.".

O que aparece em cada situação:

| Situação | O que a nutricionista vê |
|---|---|
| O suporte ainda não liberou a IA | "A IA ainda não foi liberada para o seu consultório." |
| Liberada, nunca ativada | O aditivo, a caixa "Li e aceito o aditivo de inteligência artificial (versão 1.0)" e o botão **"Ativar a IA no consultório"** |
| Aceitou um aditivo anterior (0.1 ou 0.2, provisórios) | "Para continuar usando a IA, aceite a versão atual do aditivo de inteligência artificial.", o aditivo 1.0, a mesma caixa e o botão **"Aceitar a versão atual"**. Até aceitar, nenhuma leitura de IA nem pedido de autorização |
| Ativa | "IA ativada." (logo depois de ativar), "Uso da IA neste mês: N% do limite", o aditivo e **"Desativar a IA"** |

#### 1.6.10 Cópia dos dados e exclusão

- A cópia dos dados do paciente (ZIP) traz cada autorização e retirada (data, versão, destino, canal), o termo em papel na
  pasta `autorizacao-ia/` e cada pedido de leitura à IA (situação, datas e, se o laudo saiu, quando saiu e para qual
  fornecedor e país, como "Anthropic (Claude), Estados Unidos"). A sugestão da IA em si não entra na cópia; os valores
  que a nutricionista conferiu e salvou entram no exame.
- O pedido de exclusão não apaga o termo nem os registros: eles são a prova da autorização até a anonimização do paciente.

---

### 1.7 Capítulo "Portal do paciente" › "Meus exames" — correção de 09/10/2026

> Fonte: `src/app/p/(portal)/exames/page.tsx`, `atualizar-enquanto-processa.tsx`, `anunciar-situacoes.tsx`,
> `src/app/globals.css`.

| Trecho atual (proposta do Plano 12) | Texto novo |
|---|---|
| "O app está preparando o arquivo. Leva alguns instantes. A tela não se atualiza sozinha: saia e volte para "Meus exames"." | "O app está preparando o arquivo. Leva alguns instantes. A lista se atualiza sozinha quando o preparo termina (por até 30 minutos com a tela aberta)." |

Detalhes para o manual: enquanto algum envio está "Processando…", a tela confere a situação a cada 5 segundos nos 3
primeiros minutos e depois a cada 30 segundos, até 30 minutos. Quando muda, a lista se refaz sozinha, sem perder o que está
no formulário. Com o app em segundo plano, a conferência pausa. Depois de 30 minutos, a situação nova aparece ao abrir de
novo. No iPhone, o campo "Data da coleta" agora cabe dentro do cartão.

---

### 1.8 Capítulo "Pacientes" › "Histórico de acessos" — acréscimo

Novos tipos de registro:
- **"Peso oculto no app"**, com "Ligou" e "Desligou".
- **"Autorização de IA"**: abertura do termo em papel ("Ver termo assinado").
- Em **"Documentos assinados"**, também os pareceres e as retificações.

---

### 1.9 Capítulos "Visão geral", "Como acessar" e "O que ainda não está pronto" — linhas

**Visão geral (tabela de módulos)**, linhas novas:

| Módulo | Descrição | Situação |
|---|---|---|
| Parecer nutricional e retificação | Parecer sobre os exames, assinado como a receita; retificação por versão nova de receita e parecer | No ar desde 08/10/2026, com o mesmo interruptor da receita (desligado até a liberação) |
| App do paciente (layout novo) | Cinco seções (Hoje, Jornada, Plano, Exames, Eu), mural do dia, "Comi assim", Jornada, "Não mostrar peso no app" e manual guiado do app | No ar desde 08/10/2026 |
| Autorização do paciente para IA | Autorização no app, por link no e-mail ou por termo em papel; retirada a qualquer momento | No ar desde 09/10/2026; aparece com a IA liberada no consultório, o aditivo 1.0 aceito e o perfil profissional completo |
| Inteligência artificial — textos 1.0 | Leitura de laudos com IA, com a autorização do paciente 1.0 e o aditivo da nutricionista 1.0; fornecedor Anthropic (Claude), nos Estados Unidos, com guarda de até 30 dias "para operar e proteger o serviço", sem uso para treino; o conteúdo sinalizado pelos sistemas de segurança pode ficar até 2 anos e ser revisto por pessoas do fornecedor (o que a lei exigir, pelo tempo da lei) | No ar desde 09/10/2026; liberação por consultório, pelo suporte |

**Como acessar (tabela de endereços)**, linhas novas: "/p/jornada · Paciente · Jornada"; "/p/ajuda · Paciente · Como usar o
app"; "/autorizacao-ia/... · Paciente sem app · Link do pedido de autorização de IA, sem login"; "/admin/contas/... ·
Admin · Página de uma conta"; "/admin/servidor · Admin · Backup e disco"; "/admin/seguranca · Admin · Reiniciar a
verificação em duas etapas de outra conta". Na linha de "/v": "Verificar se um documento (receita ou parecer) é autêntico".

**O que ainda não está pronto**: a linha "Assinatura gov.br e certificado digital; parecer nutricional" vira só
"Assinatura gov.br e certificado digital" (o parecer está no ar). Na linha da IA, acrescentar: "A autorização do paciente
está no ar desde 09/10/2026 (textos 1.0)". Na linha da IA, o que continua fora: resumo do histórico, rascunho de plano
e modelos sugeridos pela IA (Plano 14B). Se a linha antiga diz que a IA espera "textos finais", "parecer do advogado" ou
"retenção zero", tirar esse trecho: os textos 1.0 foram publicados sem a validação do advogado (decisão do dono, a
validação segue pendente) e o fornecedor guarda os dados por até 30 dias, com as exceções descritas nos textos 1.0
(1.6.1).

---

### 1.10 Capítulo "Pacientes" › "Pedido de exclusão" — seção nova "Prazo de guarda"

> Onde entra: no capítulo "Pacientes", na parte do pedido de exclusão (aba Privacidade do prontuário), depois de "Atender
> o pedido". Fonte: `src/modules/pacientes/lgpd.ts` (`PRAZO_GUARDA_ANOS`, `atenderPedidoExclusao`),
> `drizzle/0110_prazo_guarda_bloqueio.sql`, `src/app/painel/pacientes/[id]/privacidade/page.tsx`,
> `src/email/templates.tsx` (`exclusao_atendida`), `src/app/p/(portal)/perfil/privacidade.tsx`,
> `src/modules/plataforma/audit.ts`.

Quando você atende um pedido de exclusão, o paciente fica **bloqueado**: o prontuário clínico continua guardado,
identificado e só para sua consulta, durante o **prazo de guarda de 20 anos**. Os 20 anos contam da **data do bloqueio**
(o dia em que você atendeu o pedido, no fuso do consultório), que é o último registro do prontuário. Não importa a data da
última consulta. No fim do prazo, os dados de identificação são anonimizados sozinhos.

O que aparece na tela, na parte **"Pedido de exclusão (LGPD, art. 18)"** da aba Privacidade:

- Antes de atender: "Durante o prazo de guarda do prontuário (20 anos contados da data do bloqueio, considerada o último
  registro do prontuário — Res. CFN 594/2017, art. 3º, VI, b), os dados clínicos ficam guardados, identificados e só para
  sua consulta. Na hora são apagadas as fotos do diário, os exames enviados pelo app que ainda não foram aceitos, as
  autorizações de WhatsApp, as notificações no app e os convites; as consultas futuras são canceladas, o paciente perde o
  acesso ao portal deste acompanhamento e recebe um e-mail explicando. No fim do prazo, os dados de identificação são
  anonimizados."
- Depois de atender: "Pedido atendido em dd/mm/aaaa, hh:mm. Anonimização prevista para dd/mm/aaaa." (a data prevista é a
  do bloqueio mais 20 anos). Depois da anonimização: "Os dados de identificação já foram anonimizados."

O paciente recebe o e-mail "Seu pedido de exclusão de dados foi atendido", que diz: "Por obrigação legal (LGPD, art. 16,
I), o prontuário clínico fica guardado de forma bloqueada, só para consulta da nutricionista, até dd/mm/aaaa. Depois
dessa data, seus dados de identificação são anonimizados." No app, ao pedir a exclusão, ele lê só "O prontuário clínico é
guardado pelo prazo legal." (sem o número de anos).

**Pacientes bloqueados antes de 09/10/2026:** até essa data, o prazo contava da última consulta registrada. Em 09/10/2026
o sistema recalculou a data prevista de quem já estava bloqueado e ainda não tinha sido anonimizado: data do bloqueio mais
20 anos. A data só mudou para mais tarde, nunca para mais cedo. A mudança aparece no "Histórico de acessos" do paciente
com "Quem": "Sistema", "Ação": "Alterou" e "Registro": "Cadastro do paciente".

---

## Parte 2 — O que deixa de valer no manual atual

Não li o documento do Claude Docs: os trechos abaixo vêm das propostas aplicadas em 05/10 (portal), 06/10 (receita) e das
propostas dos Planos 11 e 12. Quem orquestra confere cada um no documento antes de trocar.

| Onde | Trecho que deixa de valer | O que fazer | Motivo / evidência |
|---|---|---|---|
| Portal do paciente, abertura | "…tem sete abas no rodapé: **Início**, **Plano**, **Diário**, **Conteúdos**, **Evolução**, **Agenda** e **Perfil**. No topo aparecem o logo e a cor do consultório, a frase "Acompanhamento com <nome>" e o botão **Sair**." | Trocar por 1.3.1 | Cinco seções no topo; Sair no fim de Eu (`src/app/p/navegacao.ts`, `perfil/page.tsx`) |
| Primeiro acesso | "Ele cai no **Início**, com o título "Meu acompanhamento"." | "Ele cai em **Hoje**, com o título "Olá, {primeiro nome}"." | `inicio/page.tsx`, `MSG_G.titulos.hoje` |
| Instalar / Notificações | "No **Início** aparece o botão **Instalar app**…", "No **Início** ou em **Perfil → Notificações**…" | Ajustar como em 1.3.11 | Cartões de Hoje e Eu |
| Plano | "A próxima refeição do dia ganha o selo "Próxima refeição"." / "toque nele para abrir a lista "Substituições"" / "As "Orientações" gerais do plano" | Trocar por 1.3.6 ("Próxima, daqui a…", trocas "ou …", "Orientações do plano") | `plano/page.tsx`, `refeicao-detalhe.tsx` |
| Evolução e orientações | Seção inteira ("A aba **Evolução** abre "Minha evolução"…", "Orientações recebidas"…) | Trocar por 1.3.5 (Jornada e "Todas as medidas") | `jornada/page.tsx`, `evolucao/page.tsx` |
| Consultas pela aba Agenda | "A aba **Agenda** abre "Minhas consultas"…" e "O **Início** também mostra "Próxima consulta"." | "Em **Jornada**, **"Minhas consultas"** abre…" e "A próxima consulta (7 dias) aparece no mural de Hoje, com "Confirmar presença"." O resto da seção vale | `SECOES_DO_PORTAL`, `mural-regras.ts` |
| Diário com foto | "Na aba **Diário**, em "Registrar refeição"" | "Em **Hoje**, toque em "Ver todo o diário" (ou "Foto da refeição") e use "Registrar refeição"" + 1.3.3 e 1.3.4 | `diario/page.tsx` |
| Perfil | "A aba **Perfil** mostra "Conectado como <e-mail>." e as partes Notificações e Privacidade…" (e, depois do 10A, "o link **Meus documentos**") | Trocar por 1.3.8 | `perfil/page.tsx` |
| Conteúdos | Referências à aba **Conteúdos** | "Em **Plano**, botão **"Conteúdos"**" | `plano/page.tsx` |
| Meus exames (proposta do Plano 12) | "Meus exames não é uma aba da barra de baixo… na aba **Início**, botão **"Enviar exame"**; na aba **Perfil**, link **"Meus exames"**. Na tela "Meus exames", a aba **Perfil** fica marcada na barra." | "**Exames** é uma das seções do topo. **"Enviar exame"** também está na barra "Ações" de Hoje." | `navegacao.ts`, `barra-de-acoes.tsx` |
| Meus exames (Plano 12) | "Se a nutricionista desligar o recebimento, "Enviar exame" e "Meus exames" somem do Início e do Perfil." | "Se a nutricionista desligar o recebimento, "Enviar exame" some da barra e da seção Exames; a seção Exames continua para quem já tem envio." | `secoesDoPortal`, `exames/page.tsx` |
| Meus exames (Plano 12) | "A tela não se atualiza sozinha: saia e volte para "Meus exames"." | Trocar por 1.7 | `atualizar-enquanto-processa.tsx` |
| Administração | A descrição da tabela "Contas de nutricionista" com cotas, métricas, IA, "Documentos" e "Exames do app" em colunas; a tabela de ações (Liberar a receita na coluna "Documentos", Suspender, Reenviar convite) e o painel de backup e disco na mesma página | Trocar por 1.2 (lista enxuta, página da conta, abas Servidor e Segurança) | `src/app/admin/**` |
| Administração (proposta do Plano 12) | "na tabela de consultórios, depois da coluna da IA… coluna "Exames do app"" | "na página da conta, cartão "Uso no mês", item "Exames do app"" | `contas/[id]/page.tsx` |
| Receita, abertura | "Liberar "Documentos" para o consultório, em /admin (coluna "Documentos" → Liberar)" | "…em /admin, botão "Abrir" da conta, cartão "Liberações" → "Liberar"" | `contas/[id]/page.tsx` |
| Receita, Dados para documentos | Os dois textos do carimbo | Ver 1.1 (tabela "Dados para documentos") | `perfil/page.tsx`, `documentos-form.tsx` |
| Receita, lista | Situações "(Rascunho, Preparando o PDF, Aguardando assinatura, Assinado, Cancelado)" | Acrescentar "Substituído" | `ROTULO_STATUS` |
| Receita, Cancelar | "Cancelar uma receita" | "Cancelar um documento" + 1.1.6 | `cancelamento.ts` |
| IA (proposta do Plano 11) | "Enviar aviso por e-mail", "Registrar entrega em mãos", "Ver aviso para imprimir", "Entreguei o aviso ao paciente", "Voltar a usar IA com este paciente", "Este paciente ainda não foi informado sobre o uso de IA.", "Informado em … (e-mail/em mãos, versão …)", "Aviso enviado. A IA fica liberada para este paciente quando o e-mail for enviado.", "Este paciente pediu para não usar IA com os dados dele." e "Antes de usar a IA, informe o paciente (Privacidade > Uso de IA)." | Tirar tudo e pôr 1.6 | Plano 14A trocou a ciência pela autorização (`uso-ia.tsx`, `MSG_AUTORIZACAO`); o e-mail de aviso do Plano 11 não existe mais |
| IA (proposta do Plano 11 / 12) | "Com a IA ativa no consultório e o paciente ativo, já avisado sobre o uso de IA e sem recusa, aparece também "Aceitar e ler valores com IA"" | "…e o paciente ativo, com a autorização vigente para a leitura de laudos, aparece também…" | `exames-recebidos/[id]/page.tsx` |
| IA, Configurações | Aditivo "versão 0.1-provisorio" (ou "0.2-provisorio", se a proposta anterior já foi aplicada) | "versão 1.0" (1.6.9) | `IA_ADITIVO_VERSAO = '1.0'` (`textos-legais.ts`) |
| IA (proposta do Plano 11), Administração | Confirmação de "Liberar" a IA: "…Só com a retenção zero concedida, o parecer do advogado, a avaliação aprovada, os textos finais publicados e o backup no host (runbook do Plano 11)." e, se aplicada a proposta anterior, a recusa "Os textos legais da IA ainda são provisórios. …" | Trocar pelo texto novo de 1.2 ("…Só com a retenção configurada (zero, ou a de até 30 dias aceita na Anthropic direta), os textos 1.0 publicados, a avaliação aprovada e o backup no host (runbook da IA).") e tirar a recusa | `src/app/admin/contas/[id]/page.tsx:125`; `definirIaLiberada` (`contas.ts`) só recusa versões "-provisorio" |
| IA (proposta do Plano 11), qualquer capítulo | "A IA não guarda os dados", "retenção zero", "ainda não disponível" ou "aguarda os textos finais/o advogado" | Trocar pela guarda do texto 1.0, com as exceções (até 30 dias; conteúdo sinalizado até 2 anos e revisto por pessoas do fornecedor; o que a lei exigir, pelo tempo da lei — 1.6.1), e pelos três passos de liberação (avisos do topo) | `RETENCAO_NA_AUTORIZACAO_1_0`, `retencaoDoAditivo` (`textos-legais.ts`); `modo.ts` (`retencao: '30-dias'`) |
| Pacientes, pedido de exclusão | "…prazo de guarda do prontuário (20 anos após a última consulta)…" (ou qualquer texto que conte os 20 anos da última consulta) | Trocar pelo texto de 1.10 ("20 anos contados da data do bloqueio…") | `privacidade/page.tsx:126`; `lgpd.ts` (`atenderPedidoExclusao`: `somarAnos(hoje, PRAZO_GUARDA_ANOS)`); migration `0110` |
| Histórico de acessos (Plano 11) | Qualquer menção à ciência ou recusa de IA | Ver 1.8 | `ENTIDADE_ROTULO` |
| Roteiro (Plano 12) | Itens 2, 3, 14 e 15 da proposta do Plano 12 | Trocar pelos itens da Parte 3 (blocos C e F) | Lugar novo de "Enviar exame"/"Exames"; atualização automática; "Exames do app" na página da conta |

---

## Parte 3 — Itens novos para o "Roteiro de teste"

> Onde entra: novos blocos depois do último bloco do roteiro. Use consultório e pacientes de teste. O bloco E
> (autorização de IA) roda num consultório de teste com a IA liberada pelo suporte e o aditivo 1.0 aceito; em produção,
> só com paciente e laudo fictícios (o laudo vai à Anthropic, nos Estados Unidos).

**Bloco A — Parecer nutricional e retificação** (consultório com os documentos liberados; verificação em duas etapas
ativa; paciente de teste com pelo menos 2 exames com valores)
1. Aba Documentos: aparecem "Nova receita" e "Novo parecer nutricional".
2. "Novo parecer nutricional" → marcar 2 exames: os valores aparecem embaixo de cada um. "Salvar rascunho" → "Rascunho
   salvo.".
3. "Preparar para assinatura" sem avaliação → "Escreva a avaliação nutricional (até 5000 caracteres).". Sem exame →
   "Selecione ao menos um exame.".
4. Preencher a avaliação, marcar a declaração e preparar. Baixar o PDF: título "Parecer nutricional", tabela "Marcador ·
   Valor · Unidade · Referência" e a frase "Este parecer trata do estado nutricional…".
5. Assinar com as fotos e o código. No app do paciente: "Parecer nutricional · dd/mm/aaaa" em Meus documentos.
6. Mudar um valor de um exame usado no parecer. Na tela do parecer: "Os valores deste exame mudaram depois do parecer.".
7. "Retificar" → aparece "Versão 2 — substitui o documento …" e o campo "Motivo da retificação". Preparar sem motivo →
   "Escreva o motivo da retificação (até 500 caracteres).".
8. Com a versão 2 em rascunho, tentar "Cancelar documento" na versão 1 → "Há uma retificação em andamento (versão 2).
   Conclua ou apague a retificação antes de cancelar.".
9. Clicar em "Retificar" de novo na versão 1: abre a mesma versão 2.
10. Escrever o motivo, preparar e assinar a versão 2. Versão 1: "Substituído" e o cartão "Documento substituído" com
    "Abrir a versão 2"; lista com "· Versão 2".
11. App: a versão 2 com "· Versão 2"; a versão 1 com "Substituído por uma versão mais nova.". O motivo não aparece.
12. Verificação pública com o código da versão 1: "Documento substituído — …". Com o da versão 2: "Tipo: Parecer
    nutricional" e "Documento válido".
13. Retificar uma receita assinada: a versão nova traz a justificativa de uso da anterior.
14. Começar uma retificação e "Apagar rascunho": a versão 1 continua "Assinado".
15. Exportar os dados do paciente (equipe): o parecer e o motivo da retificação aparecem. Pedir "Baixar meus dados" no
    app: o parecer aparece, o motivo não.

**Bloco B — Administração**
1. /admin: abas "Contas", "Servidor" e "Segurança"; a linha "N ativas · N suspensas · N convites pendentes" e o resumo
   do servidor com "Ver servidor".
2. Buscar por parte do nome, pelo endereço da página pública e pelo e-mail: a conta aparece. Buscar algo inexistente →
   "Nenhuma conta encontrada."; "Limpar busca" volta à lista.
3. Com mais de 50 contas (só no ambiente de teste): "Próxima" e "Anterior" funcionam.
4. No celular: a lista vira cartões, sem rolagem lateral.
5. "Abrir" uma conta: os cartões "Uso no mês", "Liberações", "Limites", "Métricas de sucesso" e "Conta".
6. Salvar a "Cota mensal de WhatsApp" → "Salvo". Suspender e reativar uma conta de teste → "Conta suspensa. …" e "Conta
   reativada.".
7. "Liberar" a IA de uma conta de teste: a confirmação "Liberar a IA para {consultório}? Só com a retenção configurada
   (zero, ou a de até 30 dias aceita na Anthropic direta), os textos 1.0 publicados, a avaliação aprovada e o backup no
   host (runbook da IA)." → a página mostra "IA: liberada". Em produção também (os textos são 1.0).
8. Aba "Servidor": "Backup do banco", "Backup dos arquivos" e "Disco da VPS".
9. Aba "Segurança": o formulário "Reiniciar verificação em duas etapas" (testar só com uma conta de teste).

**Bloco C — App do paciente (layout novo)**
1. Abrir o app: título "Olá, {nome}", a data e as cinco seções no topo (sem "Exames" se o consultório não recebe exames e
   o paciente nunca enviou).
2. Primeira abertura depois da mudança: "O app mudou. Quer ver onde ficou cada coisa?" (conta que já usava) ou
   "Boas-vindas ao app do seu acompanhamento. Quer ver como funciona?" (conta nova). "Ver como funciona" mostra 5
   passos. Abrir de novo em outro celular: o aviso não volta.
3. Eu › "Como usar o app" → "Ver o tour de novo" abre o passeio em Hoje.
4. Com um plano publicado e uma refeição nos próximos 90 minutos: o item "Próxima refeição às …" com "Ver a refeição" e
   "Comi assim".
5. "Comi assim" → "Registrado no diário." e "Desfazer". Tocar em "Desfazer" → "Registro desfeito." e nada no diário.
6. "Comi assim" de novo e esperar 10 segundos: o registro aparece no mural ("Você", "{refeição} · Comi assim") e o botão
   some. No painel, Diários: "Comeu como no plano".
7. "Ver a refeição" → "Comi outra coisa" sem texto nem foto → "Escreva o que você comeu ou envie uma foto."; com texto →
   "Registro salvo.". No painel: "Comeu outra coisa" e "Refeição do plano: …".
8. "Mandar foto do prato" abre o diário com o campo da foto.
9. O mural não tem campo para escrever e mostra o rodapé "Seus registros do diário ficam visíveis…".
10. A nutricionista comenta um registro: no mural, "Sua nutricionista comentou seu registro (…)" com o texto dela.
11. Barra "Ações": "Foto da refeição", "Enviar exame" (só com o recebimento ligado) e "Agendar".
12. Jornada: "Sua jornada desde {mês}", gráfico "Peso nas consultas" (com 2 pesos), "Orientação da sua nutricionista" em
    cada atendimento, "Todas as medidas" e "Minhas consultas".
13. Plano: "Plano de hoje", a próxima refeição já aberta com "Próxima, daqui a …", "Baixar PDF", "Lista de compras",
    "Conteúdos".
14. Eu: "Conta", "Consultório", "Meus documentos" (se liberado), "Notificações", "Privacidade", "Como usar o app" e
    "Sair" no fim.
15. Sem internet (modo avião), abrir uma refeição: a cópia do plano abre com a refeição e os botões desligados com "Sem
    conexão. Registre quando voltar.".
16. Celular pequeno (320 px de largura): nenhuma tela rola para o lado, mesmo com textos longos no diário e no plano.
17. Atalhos antigos ainda abrem: /p/diario, /p/evolucao, /p/agenda, /p/conteudos, /p/documentos.

**Bloco D — Não mostrar peso no app**
1. Prontuário › Evolução › "Não mostrar peso no app" → "Salvar" → "Peso oculto no app desde dd/mm/aaaa".
2. No app: o resumo de Hoje não mostra kg; a Jornada não tem gráfico de peso nem de cintura; "Todas as medidas" não tem
   peso nem IMC (circunferências continuam).
3. Paciente com avaliações só de peso e altura: "Todas as medidas" mostra "Nenhuma medida para mostrar.".
4. Histórico de acessos: "Peso oculto no app" — "Ligou".
5. Desmarcar e salvar: o peso volta ao app; histórico: "Desligou".
6. "Baixar meus dados": o peso continua na cópia.

**Bloco E — Autorização de IA** (só com a IA liberada e ativa no consultório de teste e o perfil profissional completo)
0. Antes de liberar: Configurações › "Inteligência artificial (IA)" mostra "A IA ainda não foi liberada para o seu
   consultório.". Depois de o suporte liberar: o aditivo "(versão 1.0)", a caixa "Li e aceito o aditivo de inteligência
   artificial (versão 1.0)" e "Ativar a IA no consultório" → "IA ativada.".
1. Privacidade › "Uso de IA": "Ainda não autorizou." e os botões. "Ver o texto da autorização": o texto termina com
   "Versão 1.0, de 09/10/2026." e "Por quanto tempo" diz "A Anthropic guarda os dados enviados por até 30 dias, para operar
   e proteger o serviço…".
2. Na aba Exames, embaixo de um exame com laudo: "Antes de usar a IA, peça a autorização do paciente (Privacidade > Uso de
   IA)." (sem o botão "Ler valores com IA").
3. App: Eu › Privacidade › "Uso de inteligência artificial (IA)" → "Ler e decidir" → "Agora não" → "Tudo bem. Nada muda no
   seu atendimento." e nada nos "Registros" do painel.
4. "Ler e decidir" → "Autorizo o envio para fora do Brasil" → "Autorização registrada. Você pode retirar quando quiser.";
   no painel: "Autorizou em … (app, versão 1.0)."; chega o e-mail "Você autorizou o uso de inteligência
   artificial".
5. Ler valores com IA funciona.
6. App: "Retirar autorização" → confirmar → "Autorização retirada."; painel: "Retirou em …"; a leitura volta a ser recusada
   com "Este paciente retirou a autorização para o uso de IA.".
7. Outro paciente: "Enviar pedido de autorização por e-mail" → "Pedido enviado. O link vale por 7 dias."; clicar de novo
   mostra "Já há um pedido por e-mail válido até …".
8. Abrir o link do e-mail num celular sem login: o texto, "Esta autorização é pessoal…", autorizar → painel com "link
   por e-mail".
9. No e-mail de confirmação, "Retirar a autorização" → "Você já autorizou em …" → "Retirar autorização" → "Autorização
   retirada.".
10. Terceiro paciente: "Registrar termo em papel" → "Imprimir termo" pelo Chrome: rodapé com o código e "Página x de y"
    em todas as páginas.
11. Salvar com um código errado → "O código não confere com o do termo atual. …"; com o código certo, a data, o arquivo e
    a confirmação → "Termo registrado. Entregue ao paciente uma via do termo assinado."; "Ver termo assinado" abre o
    arquivo; Histórico de acessos: "Autorização de IA".
12. "Registrar retirada a pedido do paciente" → confirmar → "Retirou em dd/mm/aaaa." e, nos Registros, "dd/mm/aaaa —
    Retirou (a pedido, pela nutricionista)".
13. Configurações › IA: o aditivo "(versão 1.0)", terminando em "Versão 1.0, de 09/10/2026."; conta de teste que aceitou
    um aditivo provisório (0.1 ou 0.2) vê "Para continuar usando a IA, aceite a versão atual do aditivo de inteligência
    artificial." e "Aceitar a versão atual"; até aceitar, a aba Exames mostra a mesma frase e o paciente não vê "Ler e
    decidir".
13a. Paciente de teste que autorizou a versão provisória 0.1: no painel, "Autorizou a versão 0.1-provisorio, que não vale
    mais. Peça uma nova autorização."; no app, "O texto da autorização mudou. Leia e decida de novo.".
14. "Baixar meus dados" de um paciente que autorizou: as autorizações e o termo na pasta autorizacao-ia/; depois de uma
    leitura com IA, o pedido aparece com a data em que o laudo saiu e o fornecedor ("Anthropic (Claude), Estados Unidos"),
    sem a sugestão.

**Bloco F — Exames enviados (correção de 09/10)**
1. No app, enviar um PDF de 1 a 3 páginas e ficar na tela "Meus exames" sem recarregar: o envio sai de "Processando…" e
   vira "Aguardando sua nutricionista" sozinho, em segundos.
2. Enviar um PDF com mais de 10 páginas e esperar na tela: aparece "O PDF tem mais de 10 páginas. …" sem recarregar.
3. Durante o "Processando…", digitar algo no formulário: a atualização não apaga o que foi digitado.
4. No iPhone, o campo "Data da coleta" fica dentro do cartão.
5. "Enviar exame" pela barra "Ações" de Hoje leva direto ao formulário.

**Bloco G — Prazo de guarda (PR #31)** (paciente de teste com uma consulta antiga registrada)
1. Prontuário › Privacidade › "Pedido de exclusão (LGPD, art. 18)": o texto diz "(20 anos contados da data do bloqueio,
   considerada o último registro do prontuário — Res. CFN 594/2017, art. 3º, VI, b)".
2. Atender o pedido: "Pedido atendido em dd/mm/aaaa, hh:mm. Anonimização prevista para dd/mm/aaaa." — a data prevista é
   a de hoje mais 20 anos, mesmo com a consulta antiga.
3. O e-mail "Seu pedido de exclusão de dados foi atendido" traz a mesma data em "…até dd/mm/aaaa.".

---

## Observações para quem orquestra (não vão para o manual)

1. **Divergência no manual técnico** (`docs/manual-tecnico/04-modulos-clinicos.md:55`, linha de `listarContas`): diz que a
   lista enxuta do `/admin` mostra "armazenamento". O código mostra **"Consultas no mês"** (`src/app/admin/page.tsx`,
   cabeçalhos da tabela e dos cartões); o armazenamento está só na página da conta. Corrigir no próximo fechamento.
2. A Parte 2 cita trechos das propostas, não do documento: o guardião não tem acesso de leitura ao Claude Docs nesta
   sessão. Se as propostas dos Planos 11 e 12 não foram aplicadas, as linhas delas na Parte 2 viram "não inserir" e as
   seções 1.6 e 1.7 entram já no lugar delas.
3. Manual guiado: o guia do portal (`portal-novidades` v1) ganhou o item da IA sem subir a versão (desvio 11 do Plano
   14A); `documentos` v2, `prontuario` v2 e `configuracoes` v5 já cobrem parecer, retificação, peso oculto e autorização.
   As telas novas do Plano 16 e do 14A ficam fora do `/painel` (`/p`, `/admin`, `/autorizacao-ia`), salvo
   `/painel/pacientes/[id]/privacidade/termo-ia`, coberta pelo padrão do guia `prontuario`.
4. **PR #31 (main `944cd71`).** O que mudou nesta versão do texto: avisos do topo; 1.2 (confirmação de "Liberar" a IA e
   fim da recusa dos textos provisórios); 1.6 inteira (1.6.1 com os três passos, o fornecedor e a guarda de 30 dias do
   texto 1.0; 1.6.2 e 1.6.6 com quem autorizou a 0.1; 1.6.7 com o destino do e-mail; 1.6.8 com os avisos da aba Exames;
   1.6.9 reescrita para o aditivo 1.0); 1.9; 1.10 nova (prazo de guarda); Parte 2 (quatro linhas novas ou trocadas);
   Parte 3 (cabeçalho, bloco B item 7, bloco E itens 0, 1, 2, 4, 13 e 13a, bloco G novo).
5. **"Hoje o destino é Anthropic (Claude), Estados Unidos"** vem da decisão do dono A-D27 e do runbook
   (`docs/operacao/ia.md`, passo 7: `IA_PROVEDOR=anthropic` e `IA_RETENCAO_ACEITA_30_DIAS`). O guardião não confere
   produção: se o Easypanel estiver com outro provedor, o destino mostrado na tela e nos textos é o do `IA_PROVEDOR` e
   1.6.1, 1.6.7 e 1.6.9 mudam.
6. **Erros corrigidos da versão anterior que não vinham do PR #31:** a Parte 3 dizia "blocos D e E (autorização de IA)"
   (só o E é da IA); o bloco E, item 2, mandava clicar em "Ler valores com IA", mas sem a autorização o botão não aparece
   (`iaNoExame`, `ia-exame.tsx:19-30`).
7. **Manual guiado:** o PR #31 não mudou tela do `/painel` além de dois textos (`privacidade/page.tsx:126` e um
   comentário em `ia-exame.tsx`); nenhum guia de `src/modules/ajuda/conteudo.ts` ou `portal.ts` cita versão provisória,
   retenção zero ou a contagem dos 20 anos, então nenhuma `versao` precisa subir.
8. **Revisão desta versão (achados aplicados):** perfil profissional completo como condição do bloco de IA no app
   (topo, 1.6.1, 1.6.6, 1.9; `blocoIaDoApp`, `autorizacao.ts:413-423`; `perfil/ia/page.tsx:28`); exceções da guarda
   (2 anos se sinalizado, revisão humana, prazo legal) nos resumos do topo, da 1.9 e da Parte 2 (`textos-legais.ts:110-124`,
   cláusula 6 do aditivo); envios à IA na cópia dos dados (1.6.10; `exportacao-job.ts:197-215` e `:538-548`); efeito da
   retirada daí em diante e cancelamento da fila (1.6.5, 1.6.6; `registrarRetiradaPelaNutri`, `retirarNoApp` → job
   `ia-retirada`, `cancelarTarefas` só `na_fila`/`pronta`, portão em `leitura-job.ts`); o "paciente não vê nada" do topo
   virou "não pode autorizar; quem tem registro continua vendo o bloco" (`blocoIaDoApp`). A citação da LGPD dos achados
   não entrou no texto do manual (artigos não conferidos na fonte nesta sessão).
