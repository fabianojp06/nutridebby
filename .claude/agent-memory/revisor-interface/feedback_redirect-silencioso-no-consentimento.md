---
name: redirect-silencioso-no-consentimento
description: Server Action de consentimento que recusa (texto mudou, IA desligada) e faz redirect sem a mensagem que o módulo já tem; E2E que só checa o redirect
metadata:
  type: feedback
---
Ação que grava um consentimento e é recusada por texto/versão/estado mudado entre a leitura e o toque costuma terminar em `redirect(...)` sem levar a mensagem. A frase existe na constante (`MSG_AUTORIZACAO.textoMudou`) e o teste da ação só confere a URL.

**Why:** revisão final do Plano 14A (09/10/2026), `perfil/actions.ts:67,69`. O `exibido` costurado na integração da T8 fez a ação voltar a `/p/perfil/ia` sem aviso; o PWA fica aberto por dias e o 14B sobe a versão, então toda aba aberta cai nisso. A T8 tinha classificado a variante da linha 69 como Minor; a da 67 nasceu na integração.

**How to apply:** em `catch` de Server Action com `redirect`, ver se o erro tem texto pronto e se a página de destino o mostra (`?aviso=` conhecido, nunca o texto da URL). Importante quando o ato é consentimento ou retirada. Ver [[retorno-por-query-fora-da-tela]].

Recorrências do Plano 14A (09/10/2026) na revisão final: `<summary className="flex …">` do "Ver o texto da autorização" continuou (4ª vez, ver [[summary-e-campo-condicional]]); upload de 20 MB do termo sem "Enviando…" (ver [[foco-e-envio-sem-andamento]]); cap. 05 §5.8.1 sem a linha do plano (ver [[fechamento-guia-no-cap05]]); mensagem de erro que manda refazer algo que cai na mesma recusa (`retiradaDepoisDaData`: retirada do mesmo dia).
