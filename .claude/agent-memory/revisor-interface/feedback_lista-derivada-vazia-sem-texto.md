---
name: lista-derivada-vazia-sem-texto
description: Lista calculada por filtro (janela de dias, dia da semana) pode sair vazia sem o estado vazio desenhado; a tela mostra só a dica de rodapé
metadata:
  type: feedback
---

Quando a spec cria um filtro novo sobre uma lista derivada (Plano 19: lista de compras por janela de dias a partir de hoje, RN-248), conferir o caso "filtro válido, resultado vazio" além dos casos que a spec nomeia (semPlano, semAlimentos, textoLivreFora).

**Why:** na Tarefa 10a do Plano 19, `listaDoPlano` devolve `grupos: []` com `semAlimentos=false` quando nenhuma refeição vale nos N dias (ex.: 1 dia num domingo e o plano só tem refeições de seg a sex). `ListaCompras` então renderiza só "Marque o que já comprou: a marcação fica neste aparelho.", sem item e sem explicação.

**How to apply:** em revisão de tela com filtro de dia ou janela, procurar o ramo `grupos.length === 0` (ou equivalente) no componente cliente e na page; texto novo não está na spec, então reportar ao controlador para decidir a frase (regra 4 do CLAUDE.md). Ver também [[feedback_vazio-global-x-secao]].
