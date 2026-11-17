---
name: axe-nao-prova-foco-do-dialogo
description: Spec de acessibilidade de diálogo/abas que só roda axe e não afirma foco ao abrir, volta ao botão e setas nas abas; limite rígido de tempo no E2E em VPS compartilhada
metadata:
  type: feedback
---
Plano 19 T11 (17/11/2026, `e2e/acessibilidade-painel.spec.ts`): o diálogo "Buscar alimento" foi aberto nas 3 abas nos 3 modos com axe, mas nenhum E2E ou teste de unidade afirma o que o RNF-232 promete (foco no campo ao abrir, volta ao botão "Equivalentes de {item}" ao fechar, setas/Home/End nas abas). O axe não prova ordem de foco.

**Why:** o spec da entrega lista esses comportamentos como requisito de acessibilidade; sem asserção, uma regressão do `key` de remontagem ou do `onClose` passa verde.

**How to apply:** ao revisar E2E de diálogo/abas novos, procurar `toBeFocused` e `press('ArrowRight')`; ausentes = Minor (ou Important se o brief pedir). Também: asserção de duração (Event Timing, INP) com teto fixo no E2E pode dar falso vermelho na VPS compartilhada; preferir imprimir o número e teto largo.
