---
name: live-region-e-avisos-de-estado
description: Erros recorrentes de interface — região viva que some junto com o conteúdo; aviso de estado (IA não liberada/ativada) espalhado em cada item
metadata:
  type: feedback
---
1. `role="status"` colocado no próprio elemento que é trocado por `router.refresh()` não anuncia o resultado: a região viva precisa ser um contêiner que fica.
2. Texto de estado do consultório (ex.: IA não liberada/não ativada) deve aparecer onde a spec põe (Configurações), não ao lado de cada exame; spec US-101: "os botões aparecem" só depois de ativar.

**Why:** ambos achados na T13 do Plano 11 (aba Exames, 06/10/2026).

3. Interruptor global (ex.: `IA_DESLIGADA=1`) também não pode mostrar aviso a consultório que nunca teve a função (revisão final do Plano 11: `estadoIaDoTenant` devolve `emergencia` antes de olhar `ia_liberada`).

**How to apply:** em telas com polling/refresh, conferir onde está o aria-live; em telas que reagem a estado do tenant, conferir o estado padrão (ex.: `ia_liberada` default false) — ele vira o que todo usuário vê.

4. Região viva que nasce já com o texto. O `AtivarNotificacoes` (`notificacoes.tsx`) cria o `<p role="status">` só no estado `ativo`/`negado`, e o leitor de tela costuma não anunciar uma região viva que aparece já preenchida. Foi visto na T10 do Plano 16 (08/10/2026): o cartão de Hoje continuou na tela por causa do `agiu`, mas o foco ainda cai no `<body>`. O molde certo é o `ConfirmarNoMural`, com o status sempre montado, `tabIndex={-1}` e foco nele.
