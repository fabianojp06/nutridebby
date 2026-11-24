# Plano 23 (Agenda 2) — Textos para aprovação e perguntas ao advogado

Fechamento do Plano 23 (T12, 24/11/2026). Spec: [`2026-11-17-nutridebby-23-agenda-2-design.md`](../specs/2026-11-17-nutridebby-23-agenda-2-design.md)
(§6.2 "Textos de interface", §14.2 AG-P1 e AG-P4). Fonte: relatórios das Tarefas 2 a 11 e decisões AG-D78 e AG-D82.

**Para quem:** a Parte A é para o **dono e a Debby** (AG-P4): os textos que a interface mostra e que **não** estão na
tabela da §6.2 (a §6.2 já foi aprovada com a spec). Cada linha diz onde o texto aparece e de onde vem no código; para
trocar um texto, basta dizer a linha e a redação nova. A Parte B é para o **advogado (E-09)**, junto do AG-P1.

Marcas:
- **provisório** — texto decidido sem a revisão da Debby (ou do advogado) e que precisa dela antes de ser tratado como final;
- **ao paciente** — a pessoa atendida lê o texto (portal, página pública, link, e-mail): também vai ao pacote do E-09;
- sem marca — texto só do painel da nutricionista.

---

## Parte A — Textos de interface fora da §6.2 (dono e Debby)

### A.1 Locais de atendimento (`/painel/agenda/locais`, T2)

| Texto | Onde aparece | Código |
|---|---|---|
| "Local excluído." | Aviso depois de "Excluir" (a §6.2 não tinha texto para a exclusão) | `MSG_LOCAIS.excluido` |
| "Excluir este local?" · "Cancelar" | Confirmação da exclusão | `locais/page.tsx` |
| "Use no máximo 500 caracteres." · "Use no máximo 300 caracteres." · "Use no máximo 80 caracteres." | Erros dos campos sala, endereço e cidade | `MSG_LOCAIS.linkLongo`, `enderecoLongo`, `cidadeLonga` |
| "Escolha o tipo do local." | Erro do campo "Tipo" | `MSG_LOCAIS.tipo` |
| "Este local já tem consultas ou horários: o tipo não muda." | Erro ao trocar o tipo de um local em uso | `MSG_LOCAIS.tipoFixo` |
| "Local não encontrado." | Erro de um local que sumiu entre a tela e o clique | `MSG_LOCAIS.naoEncontrado` |
| "Ver ativos" | Volta da lista de arquivados (par de "Ver arquivados") | `locais/page.tsx` |
| "Locais ativos" · "Locais arquivados" | Título da lista | `locais/page.tsx` |
| "Nenhum local arquivado." | Lista de arquivados vazia | `locais/page.tsx` |
| "Com sala fixa" · "Sem sala fixa" · "Sem agendamento pelo paciente" | Detalhes de cada local na lista | `locais/page.tsx` |
| **provisório** (AG-P3) os dois avisos de telenutrição (RN-404): "Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante. Não grave as consultas." e "Use sala de espera ou senha e admita um paciente por vez." | Local de videoconferência | `MSG_LOCAIS.telenutricao`, `salaDeEspera` — saem **sem o número da resolução** até o texto do DOU ser conferido. Sugestões da revisão de normas (T2) para decidir: N1 "envie e guarde o comprovante" no lugar de "guardando o comprovante"; N2 acrescentar "nem capture a tela, e avise o paciente" |

### A.2 Consulta e horários no painel (T3, AG-D82)

| Texto | Onde aparece | Código |
|---|---|---|
| "Escolha o local" | Opção vazia do seletor "Local" da consulta | `consulta-form.tsx` |
| "{nome} (Presencial)" · "{nome} (Videoconferência)" | Opções dos seletores de local | `horarios/page.tsx`, `consulta-form.tsx` |
| "O local desta consulta foi arquivado." | Ao alterar uma consulta de um local arquivado | `consultas/[id]/page.tsx` |
| "Sala fixa do local" (AG-D82) | "Link da chamada" só leitura, na consulta marcada pelo paciente num local online com sala | `MSG_LOCAIS.salaFixaDoLocal` |
| "Nenhum horário neste local." | Horários, local sem regra | `horarios/page.tsx` |
| "Sem local ativo" · "Estes horários não aparecem para os pacientes." | Horários de regra sem local ativo | `horarios/page.tsx` |
| "Excluir {dia} {hh:mm}–{hh:mm} em {local}" | Nome acessível (leitor de tela) do botão "Excluir" de cada horário | `horarios/page.tsx` |
| "Horário excluído." | Definido, ainda **sem uso** (a exclusão volta sem mensagem): decidir se mostra | `MSG_AGENDA.horarioExcluido` |

### A.3 Portal, link da consulta e página pública (T4) — **ao paciente**

| Texto | Onde aparece | Código |
|---|---|---|
| " · {nome do local}" | Linha da consulta no link do e-mail (`/consulta/[token]`) e em "Sua consulta" no portal | `consulta/[token]/page.tsx`, `p/(portal)/agenda/[id]/page.tsx` |
| "Endereço: {endereço}" | "Sua consulta" no portal (o rótulo já existia no link e no e-mail) | `p/(portal)/agenda/[id]/page.tsx` |
| "Nenhum horário livre nesta semana." | Agora também num local que aceita agendamento e não tem horário na semana (o texto já existia) | `MSG_AGENDA.semHorariosNaSemana` |

Saíram destas telas: "Escolha a modalidade", "Modalidade" e os rádios "Presencial"/"Online" (o local substitui).

### A.4 Visões, filtros, legenda e impressão (T5)

| Texto | Onde aparece | Código |
|---|---|---|
| "1 consulta" (singular de "{n} consultas") | Contador do dia | `MSG_VISOES.consultas` |
| "Nenhuma consulta." · "Nenhuma consulta neste mês." | Dia vazio na lista do celular; Mês vazio | `MSG_VISOES.semConsultasNoDia`, `semConsultasNoMes` |
| "Nenhuma consulta neste período." | Lista vazia (já existia) | `MSG_VISOES.semConsultas` |
| "(hoje)" | Cabeçalho do dia na Semana e no Mês (já existia na Semana) | `MSG_VISOES.hojeMarca` |
| "Hora" · "Marcadores" | Cabeçalhos da grade | `MSG_VISOES.hora`, `marcadores` |
| "Tipo" · "Paciente" · "Local" · "Modalidade" · "Situação" | Cabeçalhos da tabela da impressão | `MSG_VISOES.impressao.colunas` |
| "{hh:mm} (até {hh:mm})" | Consulta de mais de 60 min na grade | `MSG_VISOES.ate` |
| Leitor de tela: "Anterior (dia anterior)", "Próximo (próxima semana)", "… (mês anterior)", "… (próximo período)" | Complemento oculto de "Anterior"/"Próximo" | `MSG_VISOES.vizinhos` |
| Leitor de tela: "Filtros da agenda" · "Navegação por data" · "Agenda de {período}" | Nome dos formulários e da tabela da grade | `MSG_VISOES.formularioFiltros`, `formularioData`; `page.tsx` |

### A.5 Solicitações e chave dos pedidos (T6 a T8)

| Texto | Onde aparece | Código |
|---|---|---|
| "Salvar configuração" | Botão da chave "Confirmar os pedidos antes de marcar" em Horários | `MSG_SOLICITACOES.chave.salvar` |
| "Responder em Solicitações" | Link do cartão "Solicitações ({n})" do Início | `painel/page.tsx` |
| "Recusar o pedido de {nome}?" + "A pessoa recebe um e-mail avisando." | Título e descrição do diálogo da recusa (o texto da §6.2 dividido em dois) | `MSG_SOLICITACOES.recusaTitulo`, `recusaAviso` |
| "Cancelar" | Botão de saída do diálogo da recusa | `recusar-dialogo.tsx` |
| "Aceitar o pedido de {nome}" · "Recusar o pedido de {nome}" | Nome acessível dos botões repetidos da fila | `MSG_SOLICITACOES.aceitarDe`, `recusarDe` |
| "Motivo (só você vê):" | Rótulo do motivo de um pedido recusado, na tela da consulta | `consultas/[id]/page.tsx` (de `MSG_SOLICITACOES.motivo`) |
| "{local} · App" / "{local} · Página de agendamento" | Linha de cada cartão da fila (junta dois textos da §6.2) | `solicitacoes/page.tsx` |
| "sem autorização de mensagem de aniversário" · "pedido de consulta ainda não aceito" | Motivo de uma notificação ignorada (lista de envios) | `ROTULO_MOTIVO`, `notificacoes/tipos.ts` |
| "Responda em Solicitações" (botão) + "Responda em Solicitações: {link}" (texto) | E-mail "Novo pedido de consulta" à nutricionista | `email/templates.tsx` |
| "Ver na agenda" | E-mail "Pedido de consulta retirado" à nutricionista (paciente e pessoa nova) | `email/templates.tsx` |
| "Nova pessoa: {primeiro nome} retirou o pedido de {data} às {hora}." | E-mail "Pedido de consulta retirado", desistência da pessoa nova (AG-D49) | `email/templates.tsx` |

### A.6 Pedidos — portal, link da pessoa nova e e-mails (T6 a T8) — **ao paciente**

| Texto | Onde aparece | Código |
|---|---|---|
| "Pedido cancelado" (sem ponto) | Situação do pedido que o próprio paciente retirou (o aviso da tela é "Pedido cancelado.") | `MSG_SOLICITACOES.portal.pedidoCancelado` |
| "Voltar" | Botão de saída do diálogo "Desistir deste pedido?" no portal (o foco começa nele) | `p/(portal)/agenda/acoes-consulta.tsx` |
| "Desistir do pedido" (botão) + "Desistir do pedido: {link}" (texto) | E-mail "Recebemos seu pedido de consulta" à pessoa nova | `email/templates.tsx` |
| "O horário de {data} às {hora} não foi confirmado." / "Escolha outro horário: {link}" | E-mail "não confirmado": a frase da §6.2 em dois parágrafos, mais o "Se o botão não funcionar…" de sempre | `email/templates.tsx` |
| "Muitas tentativas. Tente novamente mais tarde." | Link de desistência com `?erro=limite` (texto que já existia) | `MSG_PUBLICO.muitasTentativas` |
| "Confirmar agendamento" | Botão da etapa do código da página pública, também com a chave ligada (texto que já existia; a spec não tem outro para o pedido) | `n/[slug]/agendar-form.tsx` |

### A.7 Atendimento e ficha (T9)

| Texto | Onde aparece | Código |
|---|---|---|
| "ou" | Entre "Data" e "Em [n] semanas" no "Retorno previsto (opcional)" | `atendimento-form.tsx` |
| "Em quantas semanas" | Nome acessível do campo das semanas | `atendimento-form.tsx` |
| "Se preencher as semanas, elas valem no lugar da data." | Dica do campo | `atendimento-form.tsx` |

### A.8 Aniversariantes (T10, AG-D78)

| Texto | Onde aparece | Código |
|---|---|---|
| **provisório, ao paciente** (AG-D78): "Uma mensagem por ano, por e-mail (e, se a sua nutricionista quiser, pelo WhatsApp dela), no dia do seu aniversário. Usamos seu nome, sua data de nascimento, seu e-mail e seu telefone. Você pode desligar quando quiser, aqui ou pelo link no próprio e-mail." | Ajuda fixa do bloco "Receber mensagem de aniversário da sua nutricionista" no Perfil do portal. A §6.2 já foi ajustada para este texto, mas ele foi decidido sem a Debby e sem o advogado | `MSG_ANIVERSARIO.portal.ajuda` |
| "Abrir Aniversariantes" | Link do cartão "Aniversariantes de hoje ({n})" do Início | `MSG_ANIVERSARIO.abrir` |
| "Escolha como o paciente autorizou." · "Confirme que o paciente autorizou." · "Só paciente ativo pode autorizar mensagens de aniversário." | Erros do diálogo "Registrar autorização" | `MSG_ANIVERSARIO.formaObrigatoria`, `confirmeAutorizacao`, `naoPodeAutorizar` |
| "Autorização registrada." · "Autorização retirada." | Aviso depois das ações da linha | `MSG_ANIVERSARIO.autorizacaoRegistrada`, `autorizacaoRetirada` |
| "1 paciente" · "1 marcado" | Singular de "Vai para {n} pacientes…" e de "{n} marcados" | `MSG_ANIVERSARIO.vaiPara`, `marcados` |
| "{primeiro nome}" | Na prévia da mensagem, o lugar do nome de cada paciente | `MSG_ANIVERSARIO.primeiroNomeNaPrevia` |
| "Enviar mensagem" (título do diálogo da prévia) · "Cancelar" (nos dois diálogos) | Diálogos da prévia e da autorização | `selecao.tsx`, `autorizacao-dialogo.tsx` |
| Leitor de tela: "Selecionar {nome}" · "Registrar autorização de {nome}" (também o título do diálogo) · "Retirar autorização de {nome}" · "Abrir no WhatsApp: {nome}" · colunas "Selecionar" e "Ações" · navegação "Meses" · grupo "Prévia da mensagem" | Nomes acessíveis da lista | `MSG_ANIVERSARIO.selecionar`, `registrarDe`, `retirarDe`, `whatsappDe`, `colunaSelecao`, `colunaAcoes`, `navegacaoDoMes`, `previa` |

Sugestão da revisão de normas (T10, Minor): um lembrete do art. 9º da LGPD no diálogo "Registrar autorização" (por
exemplo, que o paciente foi informado do canal e dos dados usados). Decidir se entra e com que texto.

### A.9 Filtro de local em Pacientes e no Financeiro (T11, AG-D79)

| Texto | Onde aparece | Código |
|---|---|---|
| "Sem local" | Opção do filtro "Local" no Financeiro (lançamento sem consulta ou de consulta antiga); está na US-416, não na §6.2 | `MSG_FILTRO_LOCAL.semLocal` |
| "Local dos lançamentos" | Seletor de local do CSV em Relatórios (o filtro da página continua "Local") | `MSG_FILTRO_LOCAL.localDosLancamentos` |
| "Arquivados" | Grupo dos locais arquivados com histórico nos seletores de Pacientes, Lançamentos, Relatórios e CSV | `MSG_FILTRO_LOCAL.arquivados` |
| "Local: {nome}" · "Local: Todos os locais" · "Local: Sem local" | Recorte no cartão dos 12 meses, no fluxo de caixa e no Resumo (a forma da impressão) | `MSG_FILTRO_LOCAL.recorte` |
| "Escolha um local da lista." | Erro do CSV com um local que não é opção (`?erro=local`) | `MSG_FILTRO_LOCAL.localInvalido` |

### A.10 Manual guiado (Ajuda) — rascunho

Os guias subiram uma versão na T12 (quem já viu o tour vê o aviso de novo): `agenda` 3, `horarios` 2, `configuracoes`
10, `financeiro` 2, `pacientes` 3, `prontuario` 5 e o guia do portal 4. Os textos estão em
`src/modules/ajuda/conteudo.ts` e `src/modules/ajuda/portal.ts` e aparecem no painel em Ajuda (manual completo). São
**rascunho** até a Debby revisar, como todos os guias (P08-08). Os dois itens novos do guia do portal são **ao paciente**:

- "Ao agendar, escolha onde você quer ser atendido. Se a sua nutricionista confirma os pedidos, a consulta fica
  "Aguardando confirmação da nutricionista" até ela responder, e a resposta chega por e-mail. Antes disso, você pode
  tocar em "Desistir do pedido"."
- "Em Eu, você autoriza ou retira a mensagem de aniversário da sua nutricionista quando quiser."

---

## Parte B — Perguntas ao advogado (E-09)

Do registro da execução (`.superpowers/sdd/2026-11-17-nutridebby-23-agenda-2/progress.md`), das revisões de normas e da
§14.2 da spec (AG-P1). Juntar ao pacote do E-09 (a orquestradora mantém `.sessoes/pacote-advogado-e09.md`).

1. **Base legal da mensagem de aniversário** (AG-P1): consentimento ou legítimo interesse? O opt-in declarado pela
   nutricionista (origem `nutri`, com a forma "Por escrito", "Por mensagem" ou "Verbalmente") vale como consentimento?
2. **Autorização verbal registrada pela nutricionista** (T10): a forma "Verbalmente" basta como prova (LGPD, art. 8º,
   § 2º: o ônus é do controlador), ou a tela deve pedir comprovante?
3. **WhatsApp manual com a autorização do aniversário** (T10, AG-D78): a autorização informada como "uma por ano, por
   e-mail (e, se a sua nutricionista quiser, pelo WhatsApp dela)" cobre o "Abrir no WhatsApp" da nutricionista? A ajuda
   provisória do portal (A.8) atende o art. 8º, § 4º, e o art. 9º, § 1º?
4. **Menores** (AG-P1, T10): hoje só recebe quem tem 18 anos ou mais. Excluir sempre, ou aceitar o consentimento do
   responsável? E o adolescente de 16 e 17 anos, à luz do Enunciado ANPD 1/2023 e da capacidade civil?
5. **O vínculo "paciente desta nutricionista"** (AG-P1) é dado de saúde (art. 5º, II)? Muda o canal (e-mail com
   "Uma mensagem da sua nutricionista" no assunto) ou o texto?
6. **Termo do paciente 1.1** (AG-P1, C-410): citar a mensagem de aniversário e os pedidos aguardando (nome, e-mail,
   telefone e IP guardados até a resposta e apagados depois de 24 horas, na limpeza diária)? Também as **cópias fora do
   sistema** que o pedido gera (o e-mail "Novo pedido de consulta" à nutricionista, com o nome e o horário, e o provedor
   de e-mail) (T7).
7. **E-mails à pessoa nova sem o nome do consultório** (T7, M4; T6, M4 "não confirmado"): os e-mails "Recebemos seu
   pedido de consulta" e "Seu pedido de consulta não foi confirmado" não dizem de qual consultório vêm. Precisa (art.
   9º, III: identificação do controlador)?
8. **Anotações só da equipe × art. 19, § 3º** (T6): o motivo da recusa de um pedido (RN-428, AG-D23: "Motivo (só você
   vê)"), as notas privadas, o motivo de cancelamento da nutricionista e o de cancelamento de documento ficam fora da
   exportação do titular por decisão do dono. A LGPD (art. 18, II; art. 19, II e § 3º) não traz exceção para anotação
   interna: a decisão se sustenta?
9. **TCLE eletrônico de telenutrição** (AG-P1, P-B3): texto do termo e se o aceite eletrônico serve de comprovante
   (também perguntado ao CRN-4, AG-P2). Hoje fica só o aviso no local de videoconferência (AG-D36).
10. **Textos ao paciente desta lista** (Parte A, marcados "ao paciente"): portal (A.3, A.6, A.8 e o guia em A.10), link da
    consulta, página pública e e-mails do pedido.

Para o **CRN-4** (AG-P2, não é do advogado; registrado aqui para não se perder): o art. 37 da Res. CFN 856/2026
("automação nas comunicações") alcança a mensagem de aniversário e os lembretes? A página de agendamento precisa do CRN?
Pode mostrar o preço da consulta?
