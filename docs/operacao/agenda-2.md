# Runbook do dono — Agenda 2 (Plano 23)

Origem: spec [`2026-11-17-nutridebby-23-agenda-2-design.md`](../superpowers/specs/2026-11-17-nutridebby-23-agenda-2-design.md)
(RNF-407, R-403, RN-410a) e plano [`2026-11-17-nutridebby-23-agenda-2.md`](../superpowers/plans/2026-11-17-nutridebby-23-agenda-2.md)
(AG-D47, AG-D68). O Plano 23 sai em PRs; este runbook ganha uma seção por PR. As migrations do PR 1 só **expandem** o
banco (colunas anuláveis ou com padrão, tabelas novas, chave "Confirmar os pedidos antes de marcar" desligada): nenhuma
volta atrás apaga coluna ou tabela.

---

## PR 1 (fundação no banco) — Volta atrás

**Nunca voltar para a imagem anterior ao PR 1.** A migration do PR 1 desdobra cada horário de atendimento "Presencial ou
online" em dois (um presencial no "Consultório" e um online na "Videoconferência", AG-D47). A imagem do PR 1 junta os dois
horários do mesmo início e fim numa vaga só, com as duas modalidades; a imagem anterior não sabe juntar: ela gera **dois
horários no mesmo instante** e recusa o agendamento online (`escolherHorario` pega o primeiro horário do instante, o
presencial, e o paciente que escolhe "online" recebe "Esse horário não está mais disponível. Escolha outro."). O banco,
por sua vez, não volta: as regras já estão desdobradas.

Se o PR 1 der problema em produção:

1. **Não** reverta para a imagem anterior. Corrija para a frente (um PR de correção sobre o PR 1) ou volte para a
   **imagem do próprio PR 1** de antes da correção que falhou.
2. A chave "Confirmar os pedidos antes de marcar" nasce desligada e só a nutricionista a liga (a tela vem num PR
   seguinte): no PR 1 não há pedido `solicitada` nem pedido de pessoa nova aguardando no banco.
3. Mudança de configuração do serviço (imagem, variáveis) só pelo Easypanel (`CLAUDE.md` do servidor, regra 1); antes
   de qualquer mudança arriscada, lembrar do snapshot no hPanel **e** do risco atual: o snapshot congela a VPS e exige
   reboot manual (aviso de 06/11/2026) — não tirar snapshot com a produção no ar sem decidir isso antes.

---

## PR 2 (locais e visões) — Volta atrás

O PR 2 não tem migration: voltar é trocar a imagem pela do **PR 1** (nunca pela anterior ao PR 1, acima). O banco fica como
o PR 2 o deixou, e a imagem do PR 1 roda sobre ele com sete efeitos conhecidos:

1. **Alterar consulta num local (o `moverConsulta` do PR 1).** A imagem do PR 1 ainda troca a modalidade (presencial ↔
   online) sem trocar o local. Numa consulta gravada pelo PR 2, que tem `local_id`, a FK composta
   `(tenant_id, local_id, modalidade)` recusa a troca: o `UPDATE` cai em **23503** e a tela dá erro 500. Mudar a data, a
   hora ou a duração sem trocar a modalidade continua funcionando. Enquanto a imagem do PR 1 estiver no ar, a
   nutricionista troca a modalidade cancelando a consulta e marcando outra.
2. **Perfil e marca.** A tela do PR 1 volta a mostrar e a gravar o "Link padrão da videoconferência"
   (`tenants.link_online_padrao`), que o PR 2 deixou de editar: o valor que aparece é o de antes do PR 2, **já
   desatualizado** — a sala de cada local, em "Locais de atendimento", é o que o PR 2 usava. Avise a nutricionista para não
   confiar nesse campo até voltar ao PR 2 (a coluna fica, AG-D7; nada é apagado).
3. **Pedido da página pública sem local.** A imagem do PR 1 grava o pedido de pessoa nova (`public_booking_requests`) sem
   `local_id`. Se a imagem do PR 2 voltar ao ar com um desses pedidos aberto (o código vale 10 minutos; o pedido
   verificado, 30), a confirmação não acha o horário (`escolherHorario` do PR 2 exige o local) e a pessoa vê "horário
   ocupado" com os outros horários da semana: escolhe de novo, sem pedir outro código. Nada fica gravado pela metade; o
   pedido que não for concluído sai na limpeza de sempre.
4. **Horários de locais sem agendamento pelo paciente ou arquivados.** A imagem do PR 1 não conhece a opção "Aceita
   agendamento pelo paciente" nem o arquivamento do local: no portal e na página pública ela oferece também os horários
   dos locais em que a nutricionista desligou essa opção e os dos locais arquivados, e a consulta marcada por ali nasce
   com o local nulo. Se houver algum local sem agendamento pelo paciente (ou arquivado com horários), **desligue a página
   pública** enquanto a imagem do PR 1 estiver no ar, e peça à nutricionista para conferir as consultas marcadas pelo
   portal nesse período (local vazio na agenda) e ajustá-las ao voltar ao PR 2.
5. **Endereço do Perfil em consulta de outro local.** Os lembretes de 24 h e de 2 h, a página `/consulta/[token]` e o
   portal da imagem do PR 1 mostram o endereço do Perfil do consultório em toda consulta presencial, também na de outro
   local presencial cadastrado no PR 2. O mesmo acontece por alguns minutos em qualquer troca de imagem, enquanto a web
   nova convive com o worker antigo (ou o contrário). Avise os pacientes com consulta presencial em outros locais
   (o endereço certo é o do local na agenda) enquanto a imagem do PR 1 estiver no ar.
6. **Consulta online sem a sala do local.** A consulta online marcada pela imagem do PR 1 leva o "Link padrão da
   videoconferência" do Perfil (`tenants.link_online_padrao`), parado desde o PR 2 (item 2), e não a sala do local. Antes
   de voltar, ou logo depois, a nutricionista confere o link de cada consulta online marcada nesse período e o corrige ao
   voltar ao PR 2 (ou envia a sala certa ao paciente).
7. **Teto de 30 horários na tela antiga.** O PR 2 aceita até 60 horários por consultório (cada linha conta). A tela de
   horários do PR 1 conta o teto de 30 com `juntarPares` (o par presencial + online do mesmo início e fim conta como um) e
   recusa regra nova quando essa conta chega a 30: com mais de 30 linhas gravadas pelo PR 2, a nutricionista não cria
   horário novo pela tela do PR 1. Os horários que já existem continuam valendo; para criar outro, exclua um que não usa
   ou espere voltar ao PR 2.

As visões (Dia, Semana, Mês e Lista), os filtros, a legenda, o marcador de aniversário e a impressão não gravam nada além do
`exportar` da impressão no `audit_log` (RN-419): voltar não deixa dado para trás. Os registros `exportar` da entidade
`agenda` ficam no `audit_log` como o resto do histórico.

## PR 3 (pedidos) — Volta atrás com a chave ligada (T6)

A imagem anterior ao PR 3 (a do PR 2) não conhece o status `solicitada`: grava a consulta do paciente sem olhar o `status`
que o gatilho devolve e por isso **agenda lembretes e manda "consulta marcada"** para um pedido que a nutricionista ainda
não aceitou; e **ninguém vence os pedidos** (o vencimento mora no `processarNotificacoes` do PR 3). Antes de trocar a
imagem com "Confirmar os pedidos antes de marcar" ligada:

1. **Desligue a chave** em Agenda › Horários (só a nutricionista muda; o gatilho `tenants_agenda_da_equipe` recusa os outros
   papéis). Os pedidos novos voltam a nascer `agendada`.
2. **Zere os pendentes:** responda (aceitar ou recusar) em Solicitações, ou espere vencer (`inicio − antecedência`), até não
   restar `solicitada` futura. Conferência no banco (só leitura, com o OK do dono): `select count(*) from appointments
   where status = 'solicitada' and inicio > now()` tem de dar 0.
3. Só então troque a imagem. Um pedido esquecido na imagem antiga continua segurando o horário (o `EXCLUDE` não muda) e
   aparece na agenda sem rótulo nem ação; volte ao PR 3 para respondê-lo.

Com a chave desligada desde sempre, o PR 3 não grava nada novo e a volta é só trocar a imagem.

## PR 3 (pedidos) — Volta atrás com a tela das Solicitações (T8)

O PR 3 não tem migration: voltar é trocar a imagem pela do **PR 2** (e nunca por uma anterior ao PR 1, acima). A T8 põe a
chave "Confirmar os pedidos antes de marcar" na tela (Agenda › Horários, seção "Pedidos de consulta"), a fila
"Solicitações" e o "Desistir do pedido" do portal e da pessoa nova. A imagem do PR 2 não tem nada disso e, com pedido
pendente no banco, deixa o pedido sem dono. Antes de trocar a imagem:

1. **Desligue a chave** em Agenda › Horários › "Pedidos de consulta" e salve ("Configuração salva."). A partir daí os
   pedidos novos do app e da página de agendamento voltam a ser marcados direto (a tela toma a trava dos pedidos do
   consultório antes de mudar a chave: um pedido em gravação termina com a chave de antes).
2. **Responda ou deixe vencer os pendentes** em Solicitações (o número da aba "Solicitações ({n})" e o cartão do Início
   mostram quantos faltam). Recusar avisa a pessoa por e-mail; aceitar marca a consulta. O que não for respondido vence em
   `início − antecedência mínima` (o vencimento roda no job de minuto das notificações).
3. **Confira no banco** (só leitura, com o OK do dono, regra 3 do servidor) que não sobrou pedido:
   - consulta de paciente aguardando: `select count(*) from appointments where status = 'solicitada'` → 0;
   - pessoa nova aguardando: `select count(*) from public_booking_requests where aguardando_desde is not null and
     resolvido_em is null` → 0.
4. Só então troque a imagem pelo Easypanel. A imagem do PR 2 lê os horários pela modalidade do local (as regras
   "ambas" já desdobradas no PR 1 continuam juntas no mesmo instante, AG-D47) e não sabe o que é `solicitada`: um pedido
   esquecido continua segurando o horário (o `EXCLUDE` não muda), aparece na agenda sem rótulo nem ação e não vence; a
   pessoa nova aguardando nunca recebe resposta e o link "Desistir do pedido" do e-mail dá 404. Volte ao PR 3 para
   resolvê-los.

Com a chave desligada desde sempre (o padrão da migration; a semente do E2E começa com ela desligada), o PR 3 não grava
nada que a imagem do PR 2 não entenda: a volta é só trocar a imagem.

## PR 3 (previsão de retorno) — Volta atrás para a imagem do PR 2 (T9)

A imagem do PR 2 não conhece a previsão de retorno (`consultations.retorno_previsto_em`, CHECK
`consultations_retorno_previsto_faixa`: entre a data do atendimento e + 730 dias). Com ela no ar — na volta atrás e
também na janela do deploy do PR 3, enquanto a imagem antiga ainda atende —, **editar a data de um atendimento que tem
previsão para depois dela** (ou para mais de 2 anos antes) cai no CHECK: o Postgres devolve 23514, a tela dá erro 500 e
o `DETAIL` do erro leva a linha inteira de `consultations` (com `orientacoes_paciente`, dado de saúde) ao log do banco
(regra 3). A imagem do PR 3 confere a faixa antes do UPDATE (`atualizarAtendimento`, RN-430) e nunca chega ao 23514.

- Antes de voltar: avisar a nutricionista para não editar a data de atendimentos com previsão até a imagem nova voltar.
- Depois de um episódio: procurar `consultations_retorno_previsto_faixa` no log do `nutri_db` e tratar as linhas como
  dado de saúde no log (rotação/limpeza conforme `docs/operacao/`), sem copiá-las para fora.
- A coluna e o CHECK ficam (expansão, RNF-407); nada a desfazer no banco.

## PR 3 (aniversariantes) — Deploy e volta atrás (T10)

O tipo `aniversario` de `notifications` nasce no PR 3: o app grava a linha ("Enviar mensagem" em Aniversariantes, para as
9h do dia do aniversário) e o worker a envia. O worker do PR 2 não conhece o tipo: a linha que ele pega vira `falhou`
(`sem_modelo`) e continua ocupando o ano do paciente no índice único `notifications_aniversario_unique` — a mensagem
daquele ano não sai, e um novo "Enviar mensagem" para o mesmo paciente no mesmo ano não grava outra.

- **Deploy:** publicar o `nutri_worker` do PR 3 **antes** do `nutri_app` (ou junto) e só usar "Enviar mensagem" em
  Aniversariantes depois que o worker do PR 3 estiver no ar. Na janela em que o app novo convive com o worker antigo,
  avisar a nutricionista para não enviar.
- **Volta atrás:** antes de trocar as imagens pelas do PR 2, conferir com a nutricionista se há mensagens de aniversário
  agendadas para os próximos dias ("Mensagens agendadas: {n}."): o worker do PR 2 as pegaria e as marcaria `falhou`. Com
  alguma agendada, esperar o envio (às 9h do dia) ou aceitar que aquela mensagem do ano não sai. Voltar o `nutri_worker`
  por último, depois do app, para nenhuma linha nova cair no worker antigo.
- Depois de um episódio: a linha `falhou`/`sem_modelo` fica como está (o ano do paciente segue ocupado). Liberar o ano
  exige mexer no banco de produção — só com a sua confirmação (regra 3), nunca como rotina deste runbook.
- O tipo e o índice ficam (expansão, RNF-407); nada a desfazer no banco.
