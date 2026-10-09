---
name: mensagem-sucesso-desmontada
description: Padrão recorrente: mensagem de sucesso guardada no useActionState de um formulário que sai da tela quando o revalidatePath troca o ramo da seção (server component)
metadata:
  type: feedback
---
Sempre conferir se a mensagem de sucesso exigida pela spec continua na tela depois que a Server Action chama `revalidatePath`.

**Why:** na T14 do Plano 11 (06/10/2026), o `IaAtivarForm` devolvia `{ ok: true }` e mostrava "IA ativada.". O `revalidatePath` redesenhava o `IaSecao` no estado `ativa`, o formulário saía da tela e a mensagem da US-101 nunca aparecia.

**How to apply:** em formulários `useActionState` que ficam dentro de um ramo condicional de um server component, ver se o sucesso muda a condição desse ramo. Se mudar, a confirmação deve vir do servidor (`?param=` depois do `redirect`, ou um componente que continua na tela). O revisor anterior e o plano deixaram passar.

Repetiu no plano do Plano 16 (08/10/2026): `ConfirmarNoMural` (`{item.podeConfirmar && …}` + `router.refresh()`) e os cartões do aparelho (`AtivarNotificacoes` com `cartao` volta `null` no estado "ativo"). Nos dois o foco também cai no `<body>`.
