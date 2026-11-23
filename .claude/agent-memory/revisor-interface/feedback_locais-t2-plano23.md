---
name: locais-t2-plano23
description: T2 do Plano 23 (Locais de atendimento) - lista com acoes via redirect sem foco no h1 (de novo); precedente FocoNoTitulo/StatusDaLista de pacientes ja existe; texto "link padrao do Perfil" fica velho entre tarefas
metadata:
  type: feedback
---
1. Lista com botoes que redirecionam com `?ok=` (arquivar/excluir/reativar/definir principal/salvar) sem mover o foco: o botao ou o
   formulario some e o foco cai no `<body>`; "Editar"/"Novo local" abre o formulario acima da lista sem levar o foco. A spec (RNF-401)
   pede foco no h1 depois das acoes que tiram linhas. O implementador adiou dizendo que o helper `focarTitulo` (Financeiro) so chega
   com outro PR, mas ja existe o precedente `FocoNoTitulo` + `StatusDaLista` (marcador `r`) em `src/app/painel/pacientes/menu-da-linha.tsx`.
2. Status fixo com `?ok=` e texto igual na 2a acao seguida nao e re-anunciado (mesmo caso de [[menu-flutuante-e-sucesso-repetido]]).
3. Troca de local do "link padrao" entre tarefas: `consulta-form.tsx` ainda diz "Vazio = o link padrao do seu perfil." depois que o Perfil perdeu o campo.
   Conferir o texto remanescente quando uma tarefa tira um campo e a seguinte troca a fonte.
4. Checkbox com `div min-h-11` mas `label` sem min-h: o alvo clicavel e o texto (24 px).

**Why:** revisao da T2 do Plano 23 (23/11/2026), commit eb62aa9. **How to apply:** em tela de lista com acoes por redirect, procure `FocoNoTitulo`.
