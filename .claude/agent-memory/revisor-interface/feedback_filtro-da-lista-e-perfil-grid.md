---
name: filtro-da-lista-e-perfil-grid
description: PR 2 do Plano 18 (revisao final) - controles do filtro da lista com 42 px; "Cadastro salvo." montado junto do texto; Perfil em grid 2 colunas com ordem visual diferente da spec; No app sem conta
metadata:
  type: feedback
---
Revisao final do PR 2 do Plano 18 (17/11/2026, branch plano-18-pr2): as correcoes das revisoes por tarefa (T7a, T8, T9) estavam
aplicadas (foco no erro, key do select, text-link, onBlur do menu, marcador `r`, min-h-11 no Campo). Sobraram so Minors:
1. `const CAMPO` local (lista) e `CAMPO` do formulario sem `min-h-11` nos controles de filtro (busca, etiqueta, ordem): 42 px, e a RNF-261 pede 44.
   Quando uma tela cria uma constante de classe de campo propria, ela escapa do `Campo` compartilhado: conferir `min-h-11` nela.
2. `{state.ok && <p role="status">Cadastro salvo.</p>}` monta a regiao junto do texto (nao e anunciada de forma confiavel). Ja era assim no PR 1.
3. Perfil: `grid md:grid-cols-2` com formulario (coluna 1, alto), Acesso (col. 2) e Etiquetas (col. 1, linha 2): a ordem visual nao e a da spec 8.4.
4. Pagina "No app" sem conta ainda continua listando configuracao sob "O que X ve hoje" (ver [[no-app-config-sem-conta]]).

**Why:** registrar o que ja foi resolvido evita reabrir; o que sobra e padrao recorrente de classe de campo duplicada.
**How to apply:** em tela nova, grep `CAMPO =`/`p-2` sem `min-h-11`; em E2E de a11y, o estado `role=status` montado junto do texto.
