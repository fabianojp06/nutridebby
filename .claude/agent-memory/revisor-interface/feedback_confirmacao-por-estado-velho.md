---
name: confirmacao-por-estado-velho
description: Erro recorrente — botão destrutivo que decide no cliente, pelo estado já renderizado, se pede confirmação; com a tela velha (job terminou), executa sem confirmar
metadata:
  type: feedback
---
Quando um botão destrutivo pula o `confirm` por causa da situação que o servidor renderizou (ex.: "processando" → o servidor só responde "Aguarde…"), conferir se a ação no servidor executa caso a situação já tenha mudado.

**Why:** na T10 do Plano 12 (07/10/2026), o `CancelarEnvio` de `/p/exames` não pedia confirmação no item "Processando…". A página não tinha polling e o worker terminava em segundos. O toque no botão cancelava o envio já "recebido" sem a confirmação da US-161. O código veio do plano.

**How to apply:** procure por `!estado && !window.confirm(...)` e por `ConfirmarBotao` condicional. Se a ação no servidor não recebe a situação que o usuário viu, é Important. Correção: passar essa situação para a ação, que só confere e refaz a lista. Ver [[polling-com-teto]].
