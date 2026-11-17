---
name: painel-que-fecha-e-sucesso-mudo
description: Seção com ações imediatas (ligar/atualizar/remover) — painel que se esconde com o foco dentro, componente que retorna null ao acabar as opções, sucesso sem região viva
metadata:
  type: feedback
---
Plano 19 T9 (17/11/2026, `ligado-ao-plano.tsx`): o botão "Ligar" fica dentro de um painel `hidden`; ao dar certo, `setAberto(false)` esconde o painel com o foco nele e o foco cai no `<body>`. Se era a última opção, o componente inteiro devolve `null`. O item novo aparece na lista e "Atualizar da biblioteca" troca a data sem nenhum `role="status"` montado: quem usa leitor de tela não sabe que deu certo.

**Why:** o "Remover" já devolvia o foco ao título da seção (molde certo), mas "Ligar" e "Atualizar" foram esquecidos; é o mesmo defeito de [[voltar-e-foco-no-botao-trocado]] e [[mensagem-sucesso-desmontada]].

**How to apply:** em toda ação que grava na hora (fora do salvamento automático), conferir: (1) para onde vai o foco depois do sucesso, inclusive quando o botão some; (2) se existe uma região `role="status"` sempre montada com a frase de sucesso; (3) o erro de uma ação aparecer junto do botão clicado, não preso ao seletor de outra ação.
