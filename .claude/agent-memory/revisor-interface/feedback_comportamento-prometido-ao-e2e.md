---
name: comportamento-prometido-ao-e2e
description: Teste de unidade que só olha a marcação e delega o comportamento "ao E2E da tarefa seguinte" — o E2E não cobre (diálogo de saída, rede caída, beforeunload do questionário, Plano 27 PR 2)
metadata:
  type: feedback
---
Quando o teste de unidade de um componente cliente diz "o comportamento vem no E2E da T6" (ou do PR seguinte), abrir o E2E e procurar o
texto da tela (`Sair sem enviar`, `Continuar respondendo`, `setOffline`, `beforeunload`). Se não achar, o comportamento prometido não é
provado por nada.

**Why:** revisão final do PR 2 do Plano 27 (24/11/2026): `formulario-questionario.test.ts` só confere o `<dialog>` fechado no HTML estático;
o ledger mandou a T6 cobrir "diálogo de saída, beforeunload, offline mantendo o digitado" e `questionario.spec.ts` cobre foco no resumo,
409 e 360 px, mas nenhum dos três. O diálogo depende de `autoFocus` num botão dentro de `<dialog>`: o React não grava o atributo
`autofocus` em elemento criado no cliente (só no HTML do servidor), então na navegação suave Hoje → "Responder agora" o `showModal`
foca o primeiro botão ("Sair", o destrutivo), não o "Continuar respondendo".

**How to apply:** em diálogo com ação destrutiva, o foco inicial deve ser dado por ref depois do `showModal` (ou a ordem dos botões o
garante), e o E2E abre o diálogo com a tela chegada por link interno, não por `goto`. Ver [[erro-longe-do-botao]].

Medição útil (24/11): `esbuild --bundle --minify` de um import só de `MSG_RESPOSTA` mostra que o `sql` do drizzle em `constantes.ts` é
descartado no cliente (1,9 kb) — não é problema de peso no portal.
