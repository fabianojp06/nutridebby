---
name: dialogo-erro-desmonta-e-foco-no-destrutivo
description: T8 Plano 23 - erro devolvido por action dentro de Dialogo some quando o revalidatePath desmonta o botao/dialogo; foco inicial no botao destrutivo do Dialogo; chave com "salvo" repetido
metadata:
  type: feedback
---

1. Action de confirmacao dentro do `<Dialogo>` que devolve `{erro}` e, antes, chama `revalidatePath` da propria tela: se a tela condiciona o botao
   ao estado que acabou de mudar (ex.: `c.podeDesistir`), o Dialogo desmonta aberto, a mensagem some e o foco cai no body
   (`desistirAction`, `src/app/p/(portal)/agenda/actions.ts`, PedidoMudouError). Correcao: redirect para a lista com `?ok=` de lista
   fechada (ja existe `AvisoDaLista` com foco) ou nao revalidar no ramo de erro.
2. Dialogo de confirmacao irreversivel com `data-foco-inicial` no botao que confirma ("Desistir do pedido"): o contrato do Dialogo
   (`perigo`) manda o foco em "Cancelar"/"Voltar". Na recusa da pessoa nova o foco ja vai em "Cancelar" - o portal ficou inconsistente.
3. Chave/checkbox com `<p role="status">{state.ok}</p>` fixo: o texto "Configuracao salva." fica na tela quando a pessoa muda a caixa de
   novo (salvo velho) e o 2o salvamento com o mesmo texto nao e anunciado. Usar `marcador`/`envio` como o `Mensagens` do Financeiro.
4. Nome de pessoa nova (ate 120 caracteres, texto publico) em `h2` de cartao e titulo de Dialogo sem `break-words`: estoura a 360 px.

**Why:** revisao da T8 do Plano 23 (23/11/2026), commit 2be15ca4. **How to apply:** ao revisar Dialogo com action, siga o caminho do erro ate o
que a pagina re-renderiza; confira onde cai o `data-foco-inicial`; texto livre publico em cartao -> `break-words`.
