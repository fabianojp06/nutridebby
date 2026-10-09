---
name: voltar-e-foco-no-botao-trocado
description: Erros recorrentes de interface do portal — "Voltar" por history.back com nome "Voltar para {seção}"; botão tocado que some e leva o foco junto (desfazer inalcançável)
metadata:
  type: feedback
---
1. Botão "Voltar" que faz `history.back()` quando `history.length > 1` mas se chama "Voltar para {seção}": filtros por URL (`?tipo=`, `?semana=`, `?dias=`), o redirect de uma action (remarcar) e o login antes da página contam no histórico. O destino real não é o do nome.
2. Botão que some ao ser tocado (ex.: "Comi assim" → aviso "Desfazer" com prazo): o foco vai para o `<body>` e quem usa teclado ou leitor de tela não chega ao "Desfazer" dentro do prazo. A pausa da WCAG 2.2.1 por foco não adianta se o foco não chega lá.

**Why:** os dois vieram do plano do Plano 16 (revisão de 08/10/2026, `voltar.tsx` e `comi-assim.tsx`).

**How to apply:** em componente que troca o botão por outro estado, procure quem recebe o foco depois. Em "Voltar", compare o `aria-label` com o que o clique faz. Ver [[mensagem-sucesso-desmontada]] e [[live-region-e-avisos-de-estado]].

3. A heurística "veio pelo teclado" feita com `document.activeElement === e.currentTarget` no `click` falha: o Chrome (Android e desktop) foca o `<button>` no pointerdown, então todo toque parece teclado. Na T11 do Plano 16 (08/10/2026, `comi-assim.tsx`), isso levava o foco ao "Desfazer", que pausa o prazo, e o "Comi assim" ficava sem enviar até a pessoa sair da tela. O Safari iOS não foca o botão no toque e por isso se comporta de outro jeito. Use `e.detail === 0 || el.matches(':focus-visible')`. Envio que precisa sair "ao fechar a tela" no celular precisa de `visibilitychange` (hidden), porque o `pagehide` não dispara na troca de app.
