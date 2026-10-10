---
name: axe-um-modo-so
description: E2E de tela nova que roda o axe uma vez só, no tema que a conta compartilhada nutri-e2e tiver gravado (não determinístico; escuro nunca conferido)
metadata:
  type: feedback
---
Ao revisar spec E2E de tela nova do painel, conferir se o axe roda nos três modos (claro, escuro, igual ao aparelho escuro), como em `e2e/acessibilidade-painel.spec.ts`.

**Why:** na T17 do Plano 11 (07/10/2026), `e2e/ia-laudos.spec.ts` chamava `violacoesNoPainel` uma vez com a conferência aberta. O tema é gravado na conta `nutri-e2e`, que `acessibilidade-painel.spec.ts` troca, então o modo variava e o escuro da tela nova nunca era conferido. O próprio plano mandou rodar uma vez só.

**How to apply:** estado de tela que não está nas `rotas` do `acessibilidade-painel` (query como `?conferir=`, formulário aberto) precisa do laço dos três modos na própria spec. Quando a tela usa só tokens, é Minor. Ver também [[mensagem-sucesso-desmontada]].

Repetiu no Plano 13 T10 (08/10/2026, `e2e/parecer.spec.ts`): conta E2E_DOCS (tema 'sistema' fixo no seed, então só o claro); o brief mandou uma vez. Estados novos do portal/`/v` (substituído) também ficaram fora do `acessibilidade.spec`. Classificado Minor (só tokens).
