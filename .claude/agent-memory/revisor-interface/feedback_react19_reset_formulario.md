---
name: react19-reset-formulario
description: Erro recorrente — formulário com useActionState e campos não controlados perde marcações/edições depois de um erro devolvido pela action
metadata:
  type: feedback
---
Em todo `<form action={...}>` com `useActionState`, conferir se os campos que o usuário edita (checkbox, defaultValue) são controlados. O React 19 reseta campos não controlados ao fim de cada action, mesmo quando ela devolve `{ erros }`.

**Why:** visto na T13 do Plano 11 (tabela de conferência da IA: caixas `sel` e nome/unidade/referência voltavam ao valor da IA depois de um erro). O próprio repo documenta o problema em `documentos/[docId]/receita-form.tsx` e `preparar.tsx` ("Tudo controlado"), mas o plano repetiu o padrão.

**How to apply:** formulário novo com useActionState → procurar `defaultValue`/`defaultChecked`/checkbox sem `checked` e o cenário de erro do servidor; Important se o usuário perde trabalho ou pode gravar dado errado.
