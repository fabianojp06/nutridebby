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
o PR 2 o deixou, e a imagem do PR 1 roda sobre ele com três efeitos conhecidos:

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

As visões (Dia, Semana, Mês e Lista), os filtros, a legenda, o marcador de aniversário e a impressão não gravam nada além do
`exportar` da impressão no `audit_log` (RN-419): voltar não deixa dado para trás. Os registros `exportar` da entidade
`agenda` ficam no `audit_log` como o resto do histórico.
