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
