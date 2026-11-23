---
name: sr-only-em-regiao-rolavel
description: Texto sr-only (position absolute) dentro de região overflow-x-auto sem ancestral relative estica a página na horizontal; e rollback de imagem depois de subir versão do DPA prende o painel
metadata:
  type: feedback
---
1. `.sr-only` é `position: absolute`. Dentro de um contêiner `overflow-x-auto` que NÃO é `relative`, o contêiner não é o bloco de contenção: o texto escondido, na coluna que rolou para fora, estica a página (a 360 px, 572 px de largura). Visto nos links "Ver" de Pagamentos pendentes (Plano 20, c9ade41; corrigido com `relative`). Ao criar tabela rolável com `sr-only` em célula, pôr `relative` na região. `caption.sr-only` não dá o problema (fica no início da tabela).

2. Subir `DPA_VERSAO` (ou versão de termo) com `registrarAceiteDpa` em `onConflictDoNothing` torna a volta atrás de imagem uma armadilha: quem já aceitou a 1.1 e volta a uma imagem com 1.0 não destrava (a linha `dpa-1.0` existe, `tenants.dpa_versao` fica '1.1'). Runbook que diz "volta atrás é só de imagem" está errado; o manual 03 já registra a divergência #12.

**Why:** Plano 20, PR 2 (17/11/2026).
**How to apply:** em PR que sobe versão de DPA/termo, conferir se o runbook de rollback cita o desvio; em tabela rolável nova, procurar `sr-only` dentro dela.
