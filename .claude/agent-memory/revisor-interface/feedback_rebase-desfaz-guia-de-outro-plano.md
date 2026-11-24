---
name: rebase-desfaz-guia-de-outro-plano
description: PR 4 do Plano 23 - o commit dos guias (T12) escrito antes do rebase apagou o guia "relatorios" e a v5 do boas-vindas (Plano 26) e deixou testes com versão velha e um typo de sed
metadata:
  type: feedback
---
Revisão final do PR 4 do Plano 23 (24/11/2026, HEAD 2597def5): o commit bf88bbaf (guias da T12), escrito antes de a main trazer o
Plano 26, foi reaplicado no rebase e REVERTEU conteudo.ts de outros planos: removeu o guia `relatorios` inteiro, baixou o
boas-vindas de v5 para v4 e tirou "Relatórios" do passo do menu (o menu ainda tem o item). Os testes ficaram com mistura:
`toBeGreaterThanOrEqualGreaterThanOrEqual` (typo de sed, TypeError), agenda/horarios esperando v3/v2 com o código em v4/v3, e os
testes do Plano 26 (relatorios, boas-vindas v5) apontando para o que sumiu.

**Why:** rebase de PR que mexe em arquivo comum a vários planos (conteudo.ts, conteudo.test.ts) resolve conflito pelo lado errado e
nenhum teste ainda tinha rodado depois do rebase (o ledger dizia "E2E passou antes do rebase").

**How to apply:** em toda revisão pós-rebase, `git diff <pr-anterior>..HEAD -- src/modules/ajuda/conteudo.ts` e procurar linhas
REMOVIDAS de outro plano (grep `^-.*Plano 2[0-9]`, ids de guia que somem, `versao:` que desce). Comparar `grep "^    id:"` com a main.
Também: o guia do portal é estático - "escolha onde você quer ser atendido" só vale com mais de um local (SeletorHorarios `locais.length > 1`).
