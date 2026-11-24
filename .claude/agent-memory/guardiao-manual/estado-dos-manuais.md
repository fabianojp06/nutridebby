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

**Revisão final do PR 1 do Plano 27 (23/11/2026, worktree `nutridebby-27`, base `8e91ecb`, HEAD `0c51a1e`):** o PR 1 (só banco)
não mexeu no manual; entreguei como achado Important a lista do que entra (cap. 02 §2.5.13 nova, matriz, §2.7, §2.8.2,
§2.10; cap. 04 anamnese `staff_only`/`finalidade`; cap. 07 §7.4.2 com linhas novas; cap. 01 cronologia; README com o prefixo
QP-Dn e divergências a partir de #154). Achei a cronologia do cap. 01 sem os merges #56 (Plano 18 PR 2, `07756c4`) e #55
(Plano 20 PR 2, `67dfad4`) e o cabeçalho do cap. 02 ainda em `0000`–`0125`: corrigir no próximo fechamento.

**Revisão final do PR 2 do Plano 27 (24/11/2026, worktree `nutridebby-27`, base `6d5c8d0`, HEAD `b69ce35`):** o manual
técnico do PR 2 (commit `b69ce35`, §4.2.12 e §5.5.15 novas, divergências README #158–#163, cap. 4 #20–#25) confere com o
código (~45 linhas checadas). Apontei: runbook §2 manda procurar `Tipo de e-mail desconhecido` no log, que nunca aparece
(`semDetalhe`); volta atrás sem "não editar modelo de questionário na imagem antiga" nem exportação sem questionários;
linhas de `worker/index.ts` (caps. 1, 4, 6, 7, 8, 9) só deslocadas, ainda erradas; cap. 12 "financeiro a última chave";
"Seis fluxos"/"sete arquivos" semConta (caps. 2 e 9). Manual do usuário do questionário ficou para a T10 (PR 4 depende do 19).

**Why:** o fechamento de cada plano parte do estado anterior; saber a base evita reconferir tudo.
**How to apply:** comece pelo diff desde o meu último commit e pelas pendências acima. Ver [[onde-os-manuais-envelhecem]].

## Plano 27 (worktree nutridebby-27), 24/11/2026
- Último fechamento: PR 3 do Plano 27 (metas) em `0035a3a` (branch `plano-27-metas`, conferido em `82254eb`): §4.2.13 e
  §5.5.16 novas, README #164–#172, cap. 04 divergências #26–#34, spec v0.5 (h2 no registro da meta), CLAUDE.md regras 1/2/8
  com "Plano 27 (PR 3)". 38 specs E2E; 22 guias; 34 filas (PR 3 sem fila). Pendente: manual do usuário das metas (T10),
  guia `plano-alimentar` sem passo da seção Metas (T10), carga não medida.
- Revisão final do PR 3 (24/11/2026, só leitura): apontei colisão com a `origin/main` (Plano 22: §4.2.12/13, §5.5.15,
  README #154–#160, cap. 4 #20–#30) a renumerar no rebase, 5 citações velhas e contagens do cap. 7.
- Antes: PR 2 em `3e1f6eb` (sobre `b69ce35`); PR 1 em `4158195`.
- Lições: as citações de `src/worker/index.ts` precisam ser conferidas linha a linha (somar deslocamento deixa as já
  erradas erradas); checagem de runbook "procurar no log" só com prova de que a frase chega ao log (falha de job vai ao
  Sentry e ao `output` do pg-boss, não ao log — `src/worker/sem-detalhe.ts`).
