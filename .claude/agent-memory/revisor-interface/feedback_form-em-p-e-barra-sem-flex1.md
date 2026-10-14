---
name: form-em-p-e-barra-sem-flex1
description: Componente que é <form> (SairPortal, BotaoSair) embrulhado em <p> quebra a hidratação; barra sticky do rodapé sobe para o meio quando o wrapper flex-1 do layout sai
metadata:
  type: feedback
---
Dois erros de interface vistos no Plano 16 (T4, 08/10/2026), ambos vindos do código do brief (plan-mandated):

1. `<p><SairPortal /></p>`: o SairPortal devolve `<form>`; o parser do HTML fecha o `<p>` antes do `<form>` → DOM ≠ árvore do React → erro de hidratação (dev: sobreposição; prod: re-render no cliente). Os E2E passam porque o React se recupera.
2. Barra fixa embaixo (`sticky bottom-0`) depois do `</main>`: só fica no rodapé se o `<main>` tiver `flex-1` (ou a barra `mt-auto`). Quando um layout tira o `<div className="flex-1">` que embrulhava as páginas, a barra sobe para o meio da tela em página curta.

**Why:** nenhum teste de string (renderToStaticMarkup) nem E2E acusa — só aparece no navegador real.
**How to apply:** em diff de interface, procurar `<p>` em volta de componente que renderiza `<form>`/`<div>`/`<ul>`; em barra `sticky bottom-0`, conferir a cadeia flex do layout até a página (ver também [[voltar-e-foco-no-botao-trocado]]).

Repetiu no brief da T13 do Plano 16 (08/10/2026: `<p><SairPortal /></p>` no fim de Eu). Desta vez quem implementou trocou para `<div>` por conta própria. Continue conferindo nos briefs seguintes, porque o plano copia o trecho antigo.
