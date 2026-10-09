---
name: tokens-escopados-e-impressao
description: Token novo escopado (ex. --nd-p-* do portal, Plano 16) com bloco escuro fica fora do reset do @media print de globals.css
metadata:
  type: feedback
---
Quem acrescenta tokens `--nd-*` escopados (ex. `[data-app='paciente']`) com versão para o aparelho escuro costuma esquecer o reset do `@media print` (`[data-tema] { …claros }`, D26). Os tokens gerais voltam ao claro e o escopado não. Com fundo impresso, sai fundo escuro com texto escuro.

**Why:** visto na T2 do Plano 16 (08/10/2026): o próprio implementador apontou e o caso foi classificado como Minor.

**How to apply:** em revisão de tokens novos, conferir se entram no bloco de impressão e se o teste de contraste cobre o elemento que de fato garante a visibilidade em cada modo. Ver também [[axe-um-modo-so]].
