---
name: estado-dos-manuais
description: Data e commit da última atualização de cada manual (técnico, usuário, guiado) e o que ficou pendente
metadata:
  type: project
---

**Último fechamento: Plano 17 (lembretes de rotina), 17/11/2026.** Branch `plano-17-lembretes-rotina`, base `5482450`,
conferido em `df641d3`; meu commit `59cbf0c` (só `docs/manual-tecnico`, sem push). §5.3.9 nova, §2.5.11 nova, caps.
1, 2, 4, 5, 6, 7 e README (divergências #121–#131). Proposta do manual do usuário + Central de Ajuda em
`.superpowers/sdd/2026-11-13-nutridebby-17-lembretes-rotina/propostas-manual-usuario-e-ajuda.md` (aplicação com quem
orquestra; publicar só depois do merge). Próximo fechamento: `git diff 59cbf0c..<head>`.

Pendências abertas que vi e não corrigi (fora do escopo pedido):
- `CLAUDE.md` regras 2 e 8 sem as anotações do Plano 17 (divergência #130) — avisar quem orquestra.
- Cap. 6: `src/worker/index.ts:97` (aoDesistir, removido no 14A) e `:107` na linha do `ENCRYPTION_KEY` (§6.9) apontam
  para código errado; cap. 7 tabela "Specs" sem os specs dos Planos 12–16; README "Seções principais" sem §2.5.11.
- Contagens hoje: 65 tabelas (49 RLS), 33 filas, migrations 0000–0120 (121).

Histórico anterior (resumo): Plano 11 em 07/10 (`e744a5e`); runner próprio em 12/10 (`bbd7728`); Plano 15 em 15/10
(`4f8fade`, mergeado no #37 `528ae7b`); P08-13 mergeado no #42 (21/10). Propostas do manual do usuário dos Planos
11, 12, 13/16/14A e PR #31 entregues em 07–09/10; aplicação nunca confirmada (o Docs foi refeito em 14/10 com 12 abas).

Manual guiado: `plano-alimentar` v2 (Plano 17), `portal-novidades` v3 (Plano 17; dispara "O manual do app foi
atualizado" a todos que viram a v2), `configuracoes` v8 (Plano 15).

**Why:** o fechamento de cada plano parte do estado anterior; saber a base evita reconferir tudo.
**How to apply:** comece pelo diff desde o meu último commit e pelas pendências acima. Ver [[onde-os-manuais-envelhecem]].
