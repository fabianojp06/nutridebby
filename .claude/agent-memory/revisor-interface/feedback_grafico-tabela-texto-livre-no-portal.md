---
name: grafico-tabela-texto-livre-no-portal
description: Portal no celular — GraficoLinha sem título visível (só <title> do SVG), tabela sem padding nas células (preflight zera), texto livre sem overflow-wrap
metadata:
  type: feedback
---
Três armadilhas de interface do portal que o código copiado do brief não pega, e que os testes de HTML deixam passar:
1. `GraficoLinha` (`src/modules/pacientes/ui/grafico-linha.tsx`) só põe o título no `<title>` do SVG. No celular a paciente vê um gráfico sem nome, e `toContain('Peso nas consultas')` passa mesmo assim. O título visível (h2) tem que vir da página.
2. O preflight do Tailwind zera o padding de `th`/`td`. Uma tabela nova sem `[&_td]:px-2` fica com as colunas coladas ("18/03/202622/09/2026") quando a largura cai para o min-content, o que a 320 px já acontece com 2 datas.
3. Texto livre da nutricionista (orientação, comentário) com `whitespace-pre-line` e sem `break-words`: um link longo alarga a página e cria rolagem lateral. O portal não tem `overflow-wrap` global.

**Why:** visto na T12 do Plano 16 (08/10/2026, Jornada e "Todas as medidas"). Os quatro achados Important vieram do código que o próprio brief trazia.

**How to apply:** em tela nova do portal, conferir se o gráfico tem título visível, se a tabela tem padding nas células e se o texto livre quebra. Comparar com o molde em `.superpowers/sdd/2026-10-08-plano16-preparacao/desenho/`. Texto relativo de hora ("amanhã, 14:00") no começo de título precisa de maiúscula (a spec escreve "Amanhã"). Ver também [[tokens-escopados-e-impressao]].

O item 3 apareceu de novo na T10 do Plano 16 (08/10/2026). No mural de Hoje (`mural-lista.tsx`), o comentário dela, o texto do diário e o título do conteúdo usam `whitespace-pre-line` sem `wrap-break-word`. O brief trazia o código assim. Toda tela nova do portal que mostra texto livre ainda cai nisso.

Revisão final do Plano 16 (08/10/2026): o item 3 voltou pela terceira vez. Mural e Jornada foram corrigidos por tarefa, mas o
mesmo comentário/observação em `/p/diario`, `refeicao-detalhe.tsx` e `plano/page.tsx` ficou com `whitespace-pre-line` sem
`wrap-break-word`. Em revisão final, faça `grep -rn whitespace-pre-line src/app/p` e confira cada ocorrência de texto livre,
não só a tela da tarefa. O E2E de 320 px não pega: o seed não tem comentário com URL longa.

Quarta vez (T8 do Plano 14A, 09/10/2026): agora não é texto livre, é o **e-mail de contato** do consultório (até 254 caracteres, sem ponto de quebra) dentro de texto legal (`TextoLegalView`, `${d.contato}`) em `/p/perfil/ia`. Fora o `whitespace-pre-line`, procure também e-mail e URL interpolados em texto fixo.
