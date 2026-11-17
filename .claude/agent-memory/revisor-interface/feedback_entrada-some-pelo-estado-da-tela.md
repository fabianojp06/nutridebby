---
name: entrada-some-pelo-estado-da-tela
description: Link/seção de Eu que só aparece "se houver X ativo", onde a própria tela desliga X — o paciente que desliga tudo perde a porta de volta
metadata:
  type: feedback
---
Condição de visibilidade da ENTRADA de uma tela (seção de Eu, cartão de Hoje) não pode depender do estado que a própria tela permite desligar. Plano 17 T6: `temLembretes` = ligado pela equipe E sem `desligado_pelo_paciente_em`; o paciente que desliga o único lembrete volta a Eu e a seção "Lembretes" sumiu, sem como religar (a tela, `meusLembretes`, ainda lista os desligados). O brief mandava assim (plan-mandated).

**Why:** revisão da Tarefa 6 do Plano 17 (17/11/2026).

**How to apply:** quando o brief define "só aparece quando houver X", perguntar se a tela deixa o usuário zerar X. Separar o "existe para a equipe" (entrada em Eu) do "ainda recebe" (texto do cartão de notificações de Hoje).
