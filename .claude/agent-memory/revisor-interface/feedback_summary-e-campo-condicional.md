---
name: summary-e-campo-condicional
description: Erros de interface vindos do plano — <summary> com flex perde o marcador do <details>; campo de texto livre visível para opções que o servidor descarta
metadata:
  type: feedback
---
1. `<summary className="inline-flex …">` (ou `flex`/`grid`) tira o `display: list-item` e o marcador ▶ some. O disclosure fica sem sinal de que abre. Conferir o `summary` de todo `<details>` novo; o molde certo é `ajuda-seguranca.tsx` (`min-h-11 cursor-pointer`, sem flex).
2. Caixa de texto livre sempre visível ("Escreva o motivo") quando o servidor só a grava para uma opção ("Outro motivo"): o texto se perde sem aviso. Comparar o formulário com o normalizador do módulo.

**Why:** os dois achados são da T11 do Plano 12 (07/10/2026, revisão do envio de exame: `aceitar-form`/`recusar-form`). O código veio do próprio plano, que deixou passar.

**How to apply:** em formulário novo com `<details>` ou com rádio e texto, ler o `summary` e a regra do servidor que usa o campo. Ver [[react19-reset-formulario]].

Repetiu no plano do Plano 16 (08/10/2026): a sanfona do `/p/plano` com `<summary className="flex …">` e um `h3` dentro. O próprio plano trouxe o código.

3ª vez no Plano 14A, T7 (09/10/2026): o implementador acrescentou `flex min-h-11 items-center` ao `summary` de "Ver o texto da autorização" (`uso-ia.tsx`) para chegar aos 44 px, coisa que o brief não tinha. Para 44 px sem perder o marcador, use `block`/`list-item` com `min-h-11 py-2`. Rode `git grep -n "<summary className=\"[^\"]*flex"` em toda revisão.

4ª-5ª vez no Plano 19 (revisão final, 17/11/2026): `nutrientes-do-paciente.tsx` ("Escolher nutrientes", "Ver todos os nutrientes") e `alimento-form.tsx` ("Micronutrientes (opcional)") com `<summary className="flex min-h-11 … items-center">`. O molde já estava corrigido em `ligado-ao-plano.tsx` (`min-h-11 cursor-pointer py-2`), mas o autor da T3/T5 não leu. Rodar o grep em toda revisão final.
