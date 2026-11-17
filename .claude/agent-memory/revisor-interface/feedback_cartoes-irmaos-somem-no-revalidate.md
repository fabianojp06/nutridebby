---
name: cartoes-irmaos-somem-no-revalidate
description: lista de formulários irmãos (sugestão inicial) condicionada a "não há nenhum item" some inteira quando um deles salva; resumo do portal que omite parte do que é enviado
metadata:
  type: feedback
---

Quando uma seção mostra vários formulários irmãos só enquanto o servidor devolve "lista vazia" (ex.: `sugestao: linhas.length ? null : sugestaoInicial()` no Plano 17), salvar um deles faz o `revalidatePath` trazer `sugestao = null` e o outro formulário desmonta com o que foi digitado (T5-01).

**Why:** o E2E do Plano 17 já precisou de `if (!(await salvarRefeicoes.isVisible())) ... clicar "Adicionar refeições"` para conviver com isso; sinal de comportamento incerto escondido no teste.

**How to apply:** em revisão de seção com "sugestão"/"primeira visão", conferir o que acontece com o cartão que NÃO foi salvo. Correção: guardar a sugestão no cliente (useState ajustado no render) e filtrar por `!tem(tipo)`; os botões "Adicionar X" também precisam seguir o filtro por tipo, não `!sugestao`.

Outro padrão do mesmo plano: resumo do portal (`paciente.ts resumo`) omitia o "pedir registro no diário" que o painel mostra, embora o paciente receba esse push; ao comparar painel x portal, conferir se cada coisa que gera push aparece nas duas telas.
