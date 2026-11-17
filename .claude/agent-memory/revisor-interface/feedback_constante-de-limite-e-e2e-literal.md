---
name: constante-de-limite-e-e2e-literal
description: Mudar limite/constante de texto (MAX_REFEICOES, MSG_PLANO.limite) sem varrer e2e/ — o E2E repete o número e o texto literais
metadata:
  type: feedback
---
Quando uma tarefa muda constante de limite ou mensagem (ex.: `MAX_REFEICOES` 15 para 50, `MSG_PLANO.limite`), o E2E costuma ter o
texto e o número escritos à mão (`e2e/plano-alimentar.spec.ts`: `LIMITE = 'O plano pode ter até 15 refeições e 200 itens.'`,
`Array.from({ length: 15 })`, `toHaveCount(16)`). O plano da tarefa só mandava "verificar" os E2E de publicação, e o do limite ficou quebrado.

**Why:** P19-04 (17/11/2026): o implementador cobriu testes unitários e de módulo, mas não o E2E do limite do editor.

**How to apply:** em tarefa que mexe em constante ou mensagem de limite, `grep -rn "<número antigo>\|<texto antigo>" e2e src docs/manual-tecnico`.
Sem rodar o E2E, é Important (a CI quebra). Ver [[confirmacao-por-estado-velho]] para outro padrão de estado que a tela não acompanha.

Também visto na mesma tarefa: aviso/erro devolvido pela action (`useActionState`) que fica na tela depois de a causa ser corrigida no editor
(o estado só muda no próximo envio). Minor quando o servidor reconfere ao publicar.
