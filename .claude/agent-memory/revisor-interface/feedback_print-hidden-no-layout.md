---
name: print-hidden-no-layout
description: print:hidden posto num layout compartilhado (cabeçalho do paciente, abas) para limpar a impressão de UMA página tira a identificação da impressão de todas as outras
metadata:
  type: feedback
---
Quando uma página nova precisa sair "limpa" na impressão (termo, documento), confira onde entra o `print:hidden`. No layout compartilhado (`src/app/painel/pacientes/[id]/layout.tsx`), ele também apaga o nome do paciente da impressão (Ctrl+P) de todas as abas do prontuário.

**Why:** visto na T7 do Plano 14A (09/10/2026). O próprio plano mandou pôr `print:hidden` no `<header data-guia="cabecalho-paciente">` e nas abas para o termo de IA. O painel é imprimível: o `@media print` de globals.css volta aos tokens claros. Classificado como Important (vem do plano).

**How to apply:** em página com `window.print()`, procure `print:hidden` em `layout.tsx`. O certo é deixar o escopo na própria página: um `<style>` com `@media print { … }` na página, ou a variante `:has(#id-da-pagina)`. Ver [[tokens-escopados-e-impressao]].
