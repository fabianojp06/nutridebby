---
name: plano-cita-guia-e-textos-fora-do-tsx
description: Revisão de plano de feature nova — guia citado é o da tela errada (prontuário x plano-alimentar), rótulos em módulo fora do scan do conteudo.test, versão do guia fixada em teste, botões repetidos sem nome distinto
metadata:
  type: feedback
---
Ao revisar o PLANO (antes da execução) de uma seção nova numa aba do prontuário ou numa página do portal:

1. O guia da aba é o do `padrao` que casa primeiro em `GUIAS` (`conteudo.ts`): Plano alimentar tem guia próprio (`plano-alimentar`, v1) que vence o `prontuario`. O plano do Plano 17 dizia "guia da tela do prontuário". Conferir `guiaDaRota` e o teste que fixa a versão (`conteudo.test.ts` `toBe(1)`; `portal.test.ts` `toBe(2)` e 5 passos): mudar o guia obriga atualizar o teste.
2. `conteudo.test.ts` só enxerga rótulos citados entre aspas no guia se estiverem em `.tsx` de `src/app/painel|conta`, `src/components` ou nos módulos de `TSX_FORA`. Plano que põe "textos da tela" em `src/modules/<novo>/constantes.ts` quebra o teste ao citar o botão no guia.
3. O guia do portal é `src/modules/ajuda/portal.ts` (arquivo, não pasta) e é texto fixo: função que depende de a nutricionista configurar algo (lembretes) leva a ressalva "se a sua nutricionista configurou" (ver [[guia-estatico-x-estado-do-consultorio]]).
4. Lista de itens com "Editar"/"Apagar"/"Salvar" repetidos precisa de nome acessível distinto (`aria-label` que contenha o texto visível).
5. Eu (`perfil/page.tsx`) não tem "lista": são `<section>` com `CARTAO` local (não exportado). `perfil/page.test.ts` fixa a ordem das seções e mocka os módulos.

**Why:** revisão do plano do Plano 17 (16/11/2026), Tarefas 5, 6 e 8.

**How to apply:** em plano com tela nova, abrir `conteudo.ts`/`portal.ts` e os testes de guia antes de aceitar "guia da tela X". Ver também [[fechamento-guia-no-cap05]] e [[mensagem-sucesso-desmontada]].
