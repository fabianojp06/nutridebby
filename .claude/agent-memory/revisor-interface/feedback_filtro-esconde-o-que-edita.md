---
name: filtro-esconde-o-que-edita
description: Filtro de visão (dia da semana no editor do plano) que esconde o cartão que a usuária está editando; link de erro por hash que não repete
metadata:
  type: feedback
---

Filtro de tela que decide a visibilidade pelo mesmo campo que o cartão edita (editor do plano, filtro de dia x checkbox "Dias") faz o cartão sumir no meio da edição: o foco vai ao body, o erro inline some, e a ordem "desmarcar antes de marcar" vira armadilha (Plano 19 T7).

**Why:** o implementador cobriu o link de erro (hashchange volta o filtro a "Todos"), mas não o caso de a própria edição tirar o cartão do filtro. Também: o `hashchange` não dispara quando o hash já é o mesmo, então o 2º clique no mesmo link de erro depois de refiltrar não faz nada.

**How to apply:** em revisão de filtro/aba/seção que esconde itens, perguntar "e se a edição feita no item o tira do filtro?" (manter o cartão visível até o filtro mudar, ou mover o foco) e "o link de erro por #id funciona a 2ª vez?". Mensagem de "vazio do filtro" (`<p>` sem role=status) não é anunciada a quem apertou o botão. Número em dois lugares da mesma tela: `formatarDecimal` usa `useGrouping:false` ("1820"), a legenda usou Intl com milhar ("1.820"): conferir consistência.
