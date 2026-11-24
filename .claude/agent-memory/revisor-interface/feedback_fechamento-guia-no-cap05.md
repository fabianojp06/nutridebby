---
name: fechamento-guia-no-cap05
description: No fechamento de plano (tarefa só de docs), a subida de versão dos guias costuma ir só para o capítulo do módulo e esquecer a §5.8.1 do cap. 05
metadata:
  type: feedback
---

Em tarefa de fechamento (manual técnico), conferir se a §5.8.1 do `docs/manual-tecnico/05-agenda-portal-conteudo.md`
ganhou a frase "Plano N: guia X na vY" — no Plano 13 a subida (`documentos` v2, `configuracoes` v4) foi só para a §9.9 do cap. 09.
Conferir também o título do capítulo no índice "Seções principais" do README quando o capítulo muda de nome.

**Why:** a §5.8.1 narra as versões dos guias plano a plano; sem a linha nova, quem lê o capítulo do manual guiado acha que a versão antiga é a atual.

**How to apply:** Minor (não bloqueia). Em revisão de doc, além disso, conferir os textos de interface citados no manual contra o código do head (`git grep -F` em `src`/`e2e`) — no Plano 13 bateram todos. Ver [[sucesso-desmontado]] para outros padrões.

Na revisão final do Plano 13 (head `c63ea12`) a §5.8.1 continuava sem a linha: o fechamento não corrigiu.

Plano 16 (T16, head `6aee56e`): de novo sem a linha. A P16-08 acrescentou perguntas comuns ao `prontuario` e ao `diarios` sem subir a versão, e a §5.8.1 não registrou; a linha do Plano 13 também continua faltando. No mesmo fechamento, o cap. 08 (M4) descrevia uma coluna da lista do `/admin` que a reorganização (T17) tinha tirado. Quando um plano reorganiza uma tela, conferir com `git show <head>:src/app/...` cada frase do manual do tipo "a lista mostra X".

Plano 20 (T12, head `291baa2`): item novo na gaveta do `inicio-paciente` sem subir a versão e sem linha na §5.8.1, enquanto a T11 subiu `agenda` para v2 por um item só de gaveta (critério inconsistente dentro do mesmo plano). Conferir `versao` x precedente do próprio plano.
