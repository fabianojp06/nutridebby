---
name: estado-dos-manuais
description: Data e commit da última atualização de cada manual (técnico, usuário, guiado) e o que ficou pendente; último = fechamento do Plano 23 (PR 4, AG-D79 a AG-D82, renumeração) em 24/11/2026
metadata:
  type: project
---

**Último: fechamento do Plano 23 (T12), 24/11/2026.** Branch `plano-23-agenda-2` (worktree `nutridebby-c`), rebaseado sobre
a `main` `96d6f94`; código conferido em `0ba8869e` + guias da T12 (`34a2b871`) + docs da T12 (`abf0b558`, outro agente).
Commit do manual: `docs(manual): fechamento do Plano 23 — PR 4, decisões AG-D79 a AG-D82 e numeração (P23-12)`.
Seções novas **no fim**: §5.13 (5.13.1–5.13.8; cap. 5 #63–#67), §6.13, §12.14. README: divergências do Plano 23
renumeradas **#161–#206** (a `main` tem #154–#160 do Plano 22) + seção "PR 4 e fechamento" #207–#211; #175/#198/#199
resolvidas (AG-D82/D80/D81; eram #168/#191/#192); "Plano 22, PR 2: #145" da `main` corrigido para #157. Glossário com 7
termos da Agenda 2; linha "Conferido contra (Plano 23)". Cap. 2: §2.5 (75 tabelas, 59 sob RLS), §2.5.1 e §2.7 com
`locais_atendimento`/`aniversario_autorizacoes`. Cap. 1: cronologia (22 mesclado #58/#69; 23 PRs 2–4 no branch).
~190 citações `arquivo:linha` refeitas (remapeador por blame + símbolo; listas de `rls-guard.ts` e `isolamento.test.ts`
e cap. 12 pelo símbolo — estavam velhas já na `main`).

**Pendente para o merge:** o plano e a spec citam "manual técnico #191/#192/#168" nas AG-D80/81/82 (agora #198/#199/#175).
Se o PR for rebaseado de novo, conferir colisão de números no README (`git show origin/main:docs/manual-tecnico/README.md
| grep "^| [0-9]* |"`).

Manual do usuário: sem acesso ao Docs; propostas da T11 e AG-D79–D82 entregues no relatório. Manual guiado: T12 subiu
pacientes v3, prontuario v5, agenda v3, horarios v2, configuracoes v10, financeiro v2, portal v4; imprimir em SEM_AJUDA.

Histórico: 23 PR 3 em 24/11 (`d4d522c`→`5adb5579` no rebase); 23 PR 2 em 23/11 (`669f7490`→`a2c8bb26`); 20 PR 2 em 17/11
(`f6cd00a`); 18 PR 1 em 17/11 (`d2d69be`); 17 em 17/11 (`59cbf0c`); 15 em 15/10 (`4f8fade`).

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
