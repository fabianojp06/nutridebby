---
name: estado-dos-manuais
description: Data e commit da última atualização de cada manual (técnico, usuário, guiado) e o que ficou pendente; último = Plano 23 PR 3 (solicitações, retorno, aniversariantes) em 24/11/2026
metadata:
  type: project
---

**Último: Plano 23, PR 3 (T6–T10), 24/11/2026.** Branch `plano-23-agenda-2` (worktree `nutridebby-c`), conferido em
`f0122aa`; commit `d4d522c` `docs(manual): Plano 23 PR 3 — solicitações, retorno e aniversariantes (P23-10)`. Seções novas **no fim**:
§2.12 (banco do PR 1 + PR 3: tabelas, gatilhos, funções SECURITY DEFINER, `STATUS_OCUPA`, status-guarda; divergências
cap. 2 #15–#21, começando em 15 porque a `main` tem #13–#14 do Plano 22), §5.12 (5.12.1–5.12.13; cap. 5 #45–#62), §6.12
(6.12.1–6.12.6; cap. 6 #11–#14). README: seção "Agenda 2 (Plano 23, PR 3)" #171–#199; #166 resolvida; "Para decidir" +#191,
#192. §5.11 teve as citações de linha refeitas (0126/0127 → 0130/0131, base `669f7490`). Cap. 1: linhas do Plano 23
(cronologia, módulos, páginas, 2 rotas POST novas).

**Rebase pendente sobre a `main`:** a `main` usa README #154–#160 (Plano 22 PR 2) → os do Plano 23 (#154–#199) andam 7
casas; cap. 2 já começa em 15. Linhas velhas por causa do PR 3 nos trechos **compartilhados** com a `main` (não mexi, regra
"só acrescentar no fim"): ~60 citações (`tenant.ts` +1 depois da linha 47, `enviar.ts` +50, `agendar.ts` +10,
`agendamento-publico.ts` +23..+25, `exportacao-job.ts` +8..+15, `mensagens.ts` +23, `transport.ts` +2/+3, `queue.ts` +1,
`atendimentos.ts` +32) nos caps. 1, 2, 3, 4, 5, 6, 7, 10, 12 e README: refazer depois do rebase com o remapeador (base
`cccb8cb2^`).

Matriz §2.5.1 e listas §2.7 do cap. 2 ainda sem `locais_atendimento`/`aniversario_autorizacoes` (texto comum com a main).
PR 2 do 23 = branch local `plano-23-pr2` (`95f0f97`), sem PR em 24/11. PR 4 (filtro de local fora da agenda) por fazer;
em 24/11 havia trabalho não commitado de outra sessão no mesmo worktree (financeiro, pacientes, e2e) — não é meu.

Manual do usuário: sem acesso ao Docs; propostas do PR 3 entregues no relatório (lista A–I). Manual guiado: `agenda` v2
cobre `solicitacoes` e `aniversariantes` só pelo `padrao`; passos/versão na T12.

Histórico: 23 PR 2 em 23/11 (`669f7490`, era `02fb478`/`013582c` antes do rebase); 20 PR 2 em 17/11 (`f6cd00a`); 18 PR 1
em 17/11 (`d2d69be`); 17 em 17/11 (`59cbf0c`); 15 em 15/10 (`4f8fade`).

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
