---
name: guia-estatico-x-estado-do-consultorio
description: Texto do manual guiado do portal (igual para todos) que afirma funções que dependem de opt-in do consultório (Exames, documentos)
metadata:
  type: feedback
---
O guia `portal-novidades` (`src/modules/ajuda/portal.ts`) é texto fixo, igual para todos os pacientes (RN-203/214). Seção ou atalho
que depende de ligar algo no consultório (Exames: `examesPacienteAtivadoEm` nasce nulo; Meus documentos: `documentosLiberados`)
não pode ser afirmado sem ressalva no resumo nem num passo do tour.

**Why:** revisão final do Plano 16 (08/10/2026): o resumo dizia "cinco partes ... Exames" e o passo "Atalhos" citava "enviar exame",
mas no estado padrão (recebimento desligado) a paciente vê 4 seções e 2 atalhos. Só o item "Exames" da ajuda tinha a ressalva.

**How to apply:** em guia novo ou alterado, liste cada função citada e veja se algum consultório não a tem por padrão. O texto
precisa valer nos dois estados (ressalva "quando o consultório ...") ou o tour pula o passo. Ver [[fechamento-guia-no-cap05]].
