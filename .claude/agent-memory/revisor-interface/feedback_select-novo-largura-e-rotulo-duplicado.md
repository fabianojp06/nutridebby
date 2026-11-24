---
name: feedback-select-novo-largura-e-rotulo-duplicado
description: T11 P23 — select de nome livre sem w-full estoura 360 px; mesmo rótulo em dois selects da página quebra getByLabel do E2E; filtro que só vale para um cartão sem aviso no cartão
metadata:
  type: feedback
---

Filtro novo com opções de texto livre (nome de local, até 60 caracteres):
- `<select>` sem `w-full` (ex.: `CAMPO` de `src/app/painel/pacientes/page.tsx`) vira item flex com min-content = opção mais longa: medido a 360 px, nome de 70 caracteres deu scrollWidth 454. O `Selecao` do Financeiro (`w-full`) não estoura. **How to apply:** ao revisar select novo em form `flex-wrap`, conferir `w-full`/`min-w-0`; medi com Chromium do Playwright num HTML de teste (pnpm node ./.x.mjs na raiz, `@playwright/test`).
- Rótulo repetido na mesma página (Relatórios: "Local" do filtro e "Local" do CSV) quebra `getByLabel('Local', { exact: true })` do E2E (strict mode) e confunde leitor de tela. **How to apply:** grep dos `label` da página inteira, não só do componente mudado.
- Filtro que recorta só um cartão (12 meses) ao lado de cartão que não obedece (fluxo): o aviso "Todos os locais" fica só no cartão que não muda; o que muda não diz qual local aplica. Precedente literal da spec: "Local: {nome ou Todos os locais}" (impressão).
- Guias do manual (`financeiro`, `pacientes`) listam os filtros por extenso; filtro novo deixa a lista velha e o plano (T12) não prevê subir a versão deles.
