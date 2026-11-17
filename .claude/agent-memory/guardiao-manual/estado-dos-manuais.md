---
name: estado-dos-manuais
description: Data e commit da última atualização de cada manual (técnico, usuário, guiado) e o que ficou pendente; último = Plano 19 PR do código em 17/11/2026
metadata:
  type: project
---

**Último: Plano 19, PR do código (plano alimentar 2), 17/11/2026.** Branch `plano-19-plano-alimentar-2` (worktree
`nutridebby-b`), base `6c3ee8f` (main com 17, 18 PR 1 #52 e 20 PR 1 #53), conferido em `a7978a6`; meu commit `f7aeae8`
(`docs/manual-tecnico`, specs MVP v1.15 + nota IA RN-116/121/126, backlog P19-xx/PD-20..28, índice). §4.3.5–§4.3.8,
§4.4.6–§4.4.10, §2.5.12, §5.5.15, §6.8.1 "Voltar atrás depois do Plano 19", §10.14.3 (R-239, `conversa-2026-11-17`);
divergências README #138–#149, cap. 4 #17–#24, cap. 5 #28–#30. Propostas do manual do usuário + Central de Ajuda em
`.superpowers/sdd/2026-11-16-nutridebby-19-plano-alimentar-2/propostas-manual-usuario-e-ajuda.md` (publicar só depois do
merge; USDA só depois do PR do seed). Próximo fechamento (Tarefa 12, seed USDA): `git diff f7aeae8..<head>`; tirar #143,
#144 (cartão "Alimentos", `{ano}`), atualizar §4.3.3/§4.3.5/§2.10 com a contagem `usda` e o índice de `nome_original`.

Pendências abertas que vi e não corrigi:
- Plano 20 PR 1 (`fin_*`, migrations 0122–0123) sem descrição no manual (só contagem e STAFF_ONLY): é do fechamento do 20.
- §7.2 "Números atuais" (testes, arquivos) não atualizado: sem a suíte final do 19.
- `index.ts:N` sem prefixo nos caps. 1 e 6 já estavam velhos antes (memória do 17); refiz só os que o 19 tocou.

Fechamentos anteriores: Plano 18 PR 1 (17/11, `d9066f9`); Plano 17 (17/11, `59cbf0c`); Plano 15 (15/10, `4f8fade`);
Plano 11 (07/10, `e744a5e`). Propostas do manual do usuário dos Planos 11–16 entregues; aplicação nunca confirmada.

Manual guiado (17/11, código do 19): `plano-alimentar` v3, `alimentos` v2, `configuracoes` v9, `biblioteca-do-plano` v1
(19º guia), `portal-novidades` v4, `inicio-paciente` v1, `prontuario` v3. No PR do seed: `alimentos` e `configuracoes` +1.

**Why:** o fechamento de cada plano parte do estado anterior; saber a base evita reconferir tudo.
**How to apply:** comece pelo diff desde o meu último commit e pelas pendências acima. Ver [[onde-os-manuais-envelhecem]].
