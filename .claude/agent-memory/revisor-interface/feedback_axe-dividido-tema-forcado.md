---
name: axe-dividido-tema-forcado
description: SUS-125 dividiu o axe do painel em duas partes; garantirTema força data-tema na tela e só anota, não falha
metadata:
  type: feedback
---

O axe do painel está em `e2e/acessibilidade-painel.spec.ts` (parte 0: claro, escuro, estados abertos, 768 px, teclado) e `acessibilidade-painel-2.spec.ts` (parte 1: igual ao aparelho, Financeiro, Plano 18, 14B-2, D17, Relatórios), com helpers em `e2e/acessibilidade-painel.ts`.

**Why:** as duas partes rodam juntas em 2 workers com a mesma conta `nutri-e2e`; outra spec trocar o tema no meio dá resultado falso. `garantirTema` põe o `data-tema` do modo do teste na tela e só anota no relatório (não falha). Isso testa o modo certo, mas um bug de "tela não segue o tema da conta" só é pego pelo D17 (agora na conta E2E_FIN_AXE).

**How to apply:** em axe novo do painel, passar `{ tema }` a `violacoes`/`axeEmTodasAsTelas`; um `AxeBuilder` solto precisa de `garantirTema` antes. Conferir IP novo por parte (lista no topo de `acessibilidade-painel.ts`) e a dúvida da IA Nutri 2 (limite de 3 abertas).
