---
name: menu-flutuante-e-sucesso-repetido
description: Menu disclosure por linha (Plano 18, T8) - painel fixed que fica aberto quando o foco sai por Tab e cobre o proximo botao; status com texto igual numa segunda acao nao e re-anunciado
metadata:
  type: feedback
---
1. Disclosure com painel `fixed` (fora do overflow) que so fecha por Esc, clique fora, item ou rolagem: o Tab no ultimo item leva ao
   botao "Acoes" da linha seguinte, que fica DEBAIXO do painel (z-30, alinhado a direita do botao). Foco invisivel e varios menus abertos.
   Procure `onBlur`/`focusout` com `relatedTarget` fora da raiz, ou `focusin` no documento.
2. Regiao `role=status` fixa com `?ok=` na URL: a segunda acao igual (arquivar outro paciente na mesma aba) volta a URL identica e o
   mesmo texto, entao nada e anunciado. O implementador declarou a limitacao; o foco no titulo nao diz o resultado.
3. Action que recusa (bloqueado) e redireciona sem `ok` e sem aviso: silencioso, mas so por pagina velha.

**Why:** achados da revisao da T8 do Plano 18 (17/11/2026), commit 74fa0ab.

**How to apply:** em menu/popup novo, tabule ate o fim do painel; em status por `?ok=`, pense na segunda acao seguida. Ver [[erro-longe-do-botao]], [[sucesso-que-some-com-revalidatepath]].
