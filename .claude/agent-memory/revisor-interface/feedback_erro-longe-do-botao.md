---
name: erro-longe-do-botao
description: Erro recorrente — campo exigido só no preparo, no topo de um formulário longo; o erro sai fora da tela e perto do botão nada muda
metadata:
  type: feedback
---
Em formulário único com "Salvar rascunho" + "Preparar para assinatura" (receita, parecer), conferir onde sai o erro de um
campo que só o **preparo** exige. Se o campo está no topo e o aviso do `Preparar` só leva `geral` e as chaves que sobram, o
clique no fim da página parece não ter feito nada.

**Why:** revisão final do Plano 13 (08/10/2026): "Motivo da retificação" (nasce vazio, obrigatório só no preparo) ficou em
`CAMPOS`/`mostradas`, então o erro só aparecia no topo. A T9 tinha classificado como Minor; na revisão final virou Important,
porque acontece em toda retificação em que a nutricionista não preencheu o motivo antes.

**How to apply:** em editor novo, procurar as chaves que o servidor só devolve no preparo e ver se a mensagem aparece perto do
botão (no aviso do `Preparar`) ou se o foco vai ao campo. Texto da spec repetido no aviso não conta como texto novo. Ver
[[react19-reset-formulario]] e [[mensagem-sucesso-desmontada]].

**Recorrência (Plano 19 T8, 17/11):** `lista-form.tsx` (lista de substituição, até 20 grupos × 30 itens) põe os erros de `nome`, `orientacao` e de cada grupo ao lado do campo, no topo/meio de uma página longa, e só `geral` junto do botão "Salvar lista"; sem foco no primeiro erro. O padrão veio do `referencia-form.tsx` (T5) e foi copiado. Em formulário de lista longa, exigir foco no primeiro campo inválido (efeito sobre `state.erros`) ou resumo perto do botão.
