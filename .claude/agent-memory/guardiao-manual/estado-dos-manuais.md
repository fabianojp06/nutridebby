---
name: estado-dos-manuais
description: Data e commit da última atualização de cada manual (técnico, usuário, guiado) e o que ficou pendente; último = Plano 20 PR 2 (Financeiro) em 17/11/2026
metadata:
  type: project
---

**Último: Plano 20, PR 2 (Financeiro do consultório), 17/11/2026.** Branch `plano-20-financeiro`, rebaseado na `main`
`6c3ee8f` (PR 1 de fundação = #53; Plano 18 PR 1 = #52 `9eeacaf`), conferido em `f6cd00a` (src igual em `0326df8`); diff do
plano = `git diff 9eeacaf..HEAD`. Commit `docs(manual): Plano 20 — Financeiro (P20-11)` (só `docs/manual-tecnico` + esta
memória). **Cap. 12 novo** (`12-financeiro.md`), §2.5.12 nova, caps. 1–10 e README (divergências #142–#153, renumeradas no rebase sobre o PR 2 do Plano 18, que ocupou #132–#141; cap. 12
#1–#12; cap. 2 #12). Material do manual do usuário + Central de Ajuda em
`.superpowers/sdd/2026-11-16-nutridebby-20-financeiro/manual-usuario-financeiro.md` (fora do git; publicar só depois do
merge do PR 2). Próximo fechamento (PR 3, T12, seção "Financeiro" no Início): `git diff <meu commit>..<head>`; tirar a #152
(cap. 12 #11) e a #151 se os textos forem aprovados; `inicio-paciente`/`prontuario` podem subir de versão.

Pendências abertas que vi e não corrigi (fora do escopo pedido):
- #153 (Comp.): volta atrás da imagem do PR 2 depois do aceite do DPA 1.1 prende a nutricionista em `/painel/dpa`
  (`registrarAceiteDpa` não regrava `tenants.dpa_versao` quando o `dpa-1.0` já existe). Avisado no relatório.
- Plano 18: #135–#137 continuam (PR 2 do 18 não entrou).
- Cap. 6: `src/worker/index.ts:97`/`:107` velhos (§6.9); cap. 7 tabela "Specs" sem os specs dos Planos 12–16.
- Contagens hoje: 68 tabelas (52 RLS), 33 filas, migrations 0000–0123 (124), 35 specs E2E, 19 guias.

Histórico anterior (resumo): Plano 18 PR 1 em 17/11 (`d2d69be`, base `667c952`); Plano 17 em 17/11 (`59cbf0c`); Plano 15
em 15/10 (`4f8fade`); Plano 11 em 07/10. Propostas do manual do usuário dos Planos 11–17 entregues em `.superpowers/sdd/`;
aplicação no Docs nunca confirmada (o Docs foi refeito em 14/10 com 12 abas).

Manual guiado: `financeiro` v1 (Plano 20, último de GUIAS), `boas-vindas` v4 e `agenda` v2 (Plano 20); `inicio-paciente`
v1 e `prontuario` v3 (Plano 18 PR 1); `plano-alimentar` v2 e `portal-novidades` v3 (Plano 17); `configuracoes` v8 (Plano 15).

**Why:** o fechamento de cada plano parte do estado anterior; saber a base evita reconferir tudo.
**How to apply:** comece pelo diff desde o meu último commit e pelas pendências acima. Ver [[onde-os-manuais-envelhecem]].
