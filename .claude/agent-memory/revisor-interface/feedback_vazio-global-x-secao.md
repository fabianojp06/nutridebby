---
name: vazio-global-x-secao
description: Estado vazio decidido pelo conjunto inteiro (mural com "Dias anteriores") quando a seção visível ("Hoje") está vazia: a tela fica em branco
metadata:
  type: feedback
---
Confira se a condição do texto de vazio é a mesma da lista que a pessoa vê.

**Why:** na T10 do Plano 16 (08/10/2026), `Mural.vazio` era `ordenados.length === 0`, contando também os dias anteriores. O `MuralLista` mostrava o "Nada para agora…" só com `vazio`. Com itens de ontem e nada hoje, "Hoje" ficava sem nenhum texto, e esse é o estado de toda manhã de quem já usa o app. O brief e os testes cobriam só o mural inteiro vazio.

**How to apply:** em tela com seção recolhida mais seção principal (histórico + hoje, anteriores + próximos), monte mentalmente o caso "só a outra seção tem itens". Ver [[mensagem-sucesso-desmontada]].
