---
name: no-app-config-sem-conta
description: Plano 18 T9 (No app do paciente) - pagina mostra configuracao como se fosse o que o paciente ve; cartao novo derruba o Inicio inteiro se falhar
metadata:
  type: feedback
---
1. Tela "o que o paciente ve no app" que, sem conta ainda (convite pendente/vencido/sem convite), continua listando linhas de
   configuracao ("Lista de compras disponivel", "2 lembretes ligados", "Peso e IMC: aparecem no app") sob uma frase de abertura
   no presente ("O que X ve hoje no app"). So a linha Acesso diz que ele nao entrou. Texto da spec, entao Minor.
2. Bloco auxiliar novo (cartao No app) entra no mesmo Promise.all do Inicio: qualquer excecao dele (TenantContextError do
   helper de papel) vira a pagina de erro do Inicio inteiro, sem estado de erro do cartao.
3. Guia `inicio-paciente` v2 diz "o cartao mostra ... os documentos" estatico; o cartao omite Documentos com documentos desligados
   (ver [[guia-estatico-x-estado-do-consultorio]]).

**Why:** revisao da T9 do Plano 18 (17/11/2026), commit e57b472. Tudo o mais bateu com a spec 8.3/8.5 palavra por palavra,
selo com texto, tokens, alvo 44 px, `/app` ja marcava o Inicio como aba atual (DO_INICIO em abas.tsx).

**How to apply:** em tela de "estado derivado" do paciente, conferir o que aparece antes de ele ter conta; em cartao novo numa
pagina com Promise.all, ver se a falha dele e isolada.
