---
name: impressao-rodape-fixo-corta-linha
description: Rodape `print:fixed` repetido por pagina cobre (e perde) a ultima linha da tabela de cada pagina; padding-bottom do main so vale no fim; correcao verificada com tfoot
metadata:
  type: feedback
---
Impressao da agenda (`/painel/agenda/imprimir`, T5 do Plano 23, 23/11/2026) com `<footer className="print:fixed print:bottom-0 print:bg-cartao">` e
`print:pb-12` no `main`: o `pb-12` so cria folga no fim do documento; o fixed repete em toda pagina e, com fundo, tapa a ultima linha
de cada pagina. Reproduzido com Chromium + PDF (90 linhas, A4, margem 10 mm): a linha 73 saiu cortada na pagina 2 e nao apareceu na 3
(pagina 1 escapou por sorte). Numa agenda impressa, um paciente some. O E2E so conferia `emulateMedia print` (botoes escondidos) e o
teste de pagina so conferia o HTML.

**Como verificar:** `page.pdf()` do playwright-core em arquivo HTML + `@hyzyla/pdfium` (render 'bitmap', BGRA) + PNG manual via zlib; sharp nao esta
no node_modules. Caminho do pdfium: `node_modules/.pnpm/@hyzyla+pdfium@2.1.13/node_modules/@hyzyla/pdfium/dist/index.esm.js`.
**Correcao testada:** `<tfoot>` (table-footer-group) numa tabela unica repete no fim de cada pagina, no fluxo, sem cobrir nada.

**How to apply:** qualquer rodape/cabecalho "que repete por pagina" feito com position:fixed em tabela longa: pedir tfoot/thead ou teste de PDF.
Ver tambem [[print-hidden-no-layout]] e [[tokens-escopados-e-impressao]].

Outros achados da mesma revisao (T5 do Plano 23): "hoje" no Mes so por cor (`text-link` + `text-ok` no mesmo link; vence o `text-ok`, ordem alfabetica
do Tailwind 4); axe dos E2E aponta para o periodo de hoje (vazio), entao itens/marcadores/bloqueio nunca passam pelo axe; controles de filtro
(Aniversarios, 24 horas) aparecem em visoes onde sao ignorados; guia `agenda` com passo "Dia, semana ou lista" ficou velho (T12 sobe a versao).
