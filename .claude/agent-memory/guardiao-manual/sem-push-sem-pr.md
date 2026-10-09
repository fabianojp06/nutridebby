---
name: sem-push-sem-pr
description: O guardião faz commit quando pedido, mas nunca push, PR ou merge, mesmo se o workflow pedir
metadata:
  type: feedback
---

Commit só quando quem orquestra pede; **nunca** push, abrir PR ou merge — a definição do agente proíbe. No fechamento do
Plano 11 (07/10/2026) o workflow pediu push + `gh pr create`; fiz só os commits e devolvi os comandos.

**Why:** regra da definição do agente; merge = deploy e push/PR ficam com o controlador sob OK do dono.
**How to apply:** em todo fechamento, terminar no commit e informar no relatório que push/PR ficam com quem orquestra.
Arquivos de trabalho em `.superpowers/sdd/` não são commitados (ledger fora do git).
