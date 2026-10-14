---
name: base-legal-no-roteiro
description: Roteiro do manual do usuário (fechamento) que atribui à lei a exigência da autorização de IA — com bedrock-eu a base é a adequação
metadata:
  type: feedback
---

No fechamento do 14A (T12, 09/10/2026), o roteiro do manual do usuário abria a seção da autorização com "A lei exige o consentimento do paciente para enviar os dados para fora do Brasil". O runbook do 14A (passo 2) proíbe qualquer texto/tela/e-mail/manual dizer que a transferência "se baseia" na autorização: com `bedrock-eu` a base é a adequação (art. 33, I) e a autorização é condição do produto (`MECANISMO` em `textos-legais.ts`).

**Why:** a Debby repete ao paciente o que o manual diz; base legal errada vira orientação errada.

**How to apply:** no roteiro do manual do usuário (fica no relatório/PR, não no diff), grep "lei exige", "consentimento", "se baseia", "art. 33" e comparar com o `MECANISMO` por destino. Conferir também "só a situação" para arquivado × bloqueado (a retirada vale sempre). Relacionado: [[fechamento-guia-no-cap05]].
