---
name: tela-movida-e-mensagens-orfas
description: Ao mover um formulário de aba (Resumo -> Perfil), mensagens e guias que apontam "o cadastro" ficam sem caminho; E2E de aceite "para cada seção" cobre só parte
metadata:
  type: feedback
---
Quando uma entrega move uma tela/aba (Plano 18 PR 1: cadastro saiu do Resumo e foi para o Perfil), procure por textos de erro e avisos
que mandam a pessoa "ao cadastro" sem link (`MSG_CADASTRO_INCOMPLETO` em gasto-energetico/antropometria) e por E2E que abrem a
URL do prontuário esperando o formulário antigo (`grep "goto(prontuario)"`, "Acesso ao portal", "Reenviar convite").

**Why:** revisão do PR 1 do Plano 18 (17/11/2026): os E2E e o guia foram ajustados, mas a mensagem das abas Antropometria e Gasto
energético continua só "no cadastro", agora uma aba adiante. Também: o critério CS-260 diz "para cada seção do registro", e o
`ficha.spec` cobre 3 destinos (Antropometria, Anamnese, Receita); gasto, exame, atendimento, plano e parecer ficaram sem prova.

**How to apply:** em PR que renomeia/move aba, grep dos textos "cadastro"/nome antigo em `src/modules/pacientes/base.ts` e nas páginas;
em critério de aceite "cada X", compare a lista do E2E com o registro (`SECOES_DA_FICHA`). Ver [[plano-cita-guia-e-textos-fora-do-tsx]].
