---
name: estado-dos-manuais
description: Data e commit da última atualização de cada manual (técnico, usuário, guiado) e o que ficou pendente; último = Plano 23 PR 2 (Agenda 2: locais, visões, impressão) em 23/11/2026
metadata:
  type: project
---

**Último: Plano 23, PR 2 (Agenda 2), 23/11/2026.** Branch `plano-23-agenda-2` (worktree `nutridebby-c`), conferido em
`02fb478`, sobre a `main` `67dfad4` (#55, Plano 20 PR 2). Commit `docs(manual): Plano 23 PR 2 — locais, visões e impressão
(P23-05)`. **§5.11 nova no fim do cap. 5** (5.11.1–5.11.8; divergências cap. 5 #28–#44 = README #154–#170, seção
"Agenda 2 (Plano 23, PR 2)"; #168 é Comp.). Linhas velhas refeitas por símbolo em caps. 1, 2, 4, 6, 7, 8, 10 e 12
(exportacao-job, marca.ts, enviar.ts, mensagens.ts, agendamento-publico.ts, test/agenda.ts, conteudo.test.ts).
Cronologia: 18 PR 2 = #56 `07756c4`; 20 PR 2 = #55 `67dfad4`; 20 PR 3 no branch `plano-20-ficha` (`291baa2`); linha
nova do Plano 23.

**PR 1 do Plano 23 (fundação no banco, 0126/0127) NÃO tem parte no manual** (a orquestradora achava que tinha): §5.11 só
traz uma tabela-resumo do banco. Caps. 2 e 6 (tabelas `locais_atendimento`, `aniversario_autorizacoes`, gatilhos, funções
SECURITY DEFINER, `aguardando_fora_do_publico`, contagem de tabelas/migrations) ficam para a T12 — avisar de novo.

Próximo fechamento (PR 3 do Plano 23, T6–T10): seções no fim do cap. 5 (§5.11.9+), caps. 2 e 6; retirar #166 (Pedido a
responder) quando `PEDIDOS_NA_AGENDA` ligar, #170 quando os guias `agenda`/`horarios` subirem; renumerar se outro plano
ocupar #154+ no README antes do rebase.

Pendências anteriores: Plano 20 #151–#152 (textos, seção Financeiro no Início = `plano-20-ficha`); cap. 6 `index.ts:N`
velhos; cap. 7 tabela "Specs" sem os specs dos Planos 12–16; `acessibilidade.spec.ts` "11 (+ laço)" já errado (21 `test(`).
Contagens: 68 tabelas no Plano 20 (o 23 PR 1 soma 2), 37 specs E2E no branch do 23.

Manual do usuário: sem acesso ao Docs na sessão; propostas entregues no relatório ao orquestrador (não aplicadas).
Manual guiado: `agenda` v2 cobre `/painel/agenda/locais` pelo `padrao`, texto velho (T12 sobe); `/painel/agenda/imprimir`
em `SEM_AJUDA`.

Histórico: Plano 20 PR 2 em 17/11 (`f6cd00a`); Plano 18 PR 1 em 17/11 (`d2d69be`); Plano 17 em 17/11 (`59cbf0c`);
Plano 15 em 15/10 (`4f8fade`).

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
