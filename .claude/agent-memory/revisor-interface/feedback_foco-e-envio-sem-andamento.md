---
name: foco-e-envio-sem-andamento
description: Erros de interface recorrentes — botão bg-destaque com focus-visible:outline-current (anel branco invisível sobre cartão claro); upload grande sem estado "enviando"
metadata:
  type: feedback
---
1. Botão escrito à mão com `bg-destaque text-white focus-visible:outline-current`: o contorno fica branco e, com `outline-offset`, cai
   sobre o `bg-cartao` branco do modo claro, então o foco some. O `:focus-visible` global (`--nd-foco`) já resolve. O certo é usar o `Botao`.
2. Formulário de upload por `fetch` (diário, envio de exame) com `<button disabled={enviando}>` sem estilo de desabilitado e sem texto de
   andamento: no PWA nada muda na tela durante o envio (até 180 s com 30 MB).

**Why:** os dois achados são da revisão final do Plano 12 (07/10/2026): `vigia-sessao.tsx` (aviso de inatividade, também no admin, que é
sempre claro) e `exames/envio-form.tsx`. As revisões por tarefa e o P12-20 viram "cor fixa", mas não o anel invisível.

**How to apply:** procure `outline-current` em botão com `text-white`, e `disabled={enviando` em botão sem `disabled:`. Com upload grande, é Important.
Ver [[live-region-e-avisos-de-estado]].
