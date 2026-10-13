---
name: estado-dos-manuais
description: Data e commit da última atualização de cada manual (técnico, usuário, guiado) e o que ficou pendente
metadata:
  type: project
---

Última atualização do **manual técnico** (`docs/manual-tecnico/`): fechamento do Plano 11, 07/10/2026, branch
`fechamento-plano-11` (commits `211564a` specs/índice/backlog, `e744a5e` manual e `c3eb4fe` correções da conferência), base `main` `2efa27b`
(PR #23). Push do `c3eb4fe` fica com quem orquestra.
Spec da IA v0.4, spec do MVP v1.13. Cap. 10 = IA; caps. 01–08 citam a IA.

**Manual técnico — CI no runner próprio** (12/10/2026, branch `runner-proprio`, base `bbd7728`, sem commit meu; o
controlador comita): §7.7 reescrita (jobs no `[self-hosted, nutri-ci]`, peças do isolamento, guardas
`test/runner-proprio.test.ts`, emergência `PUBLICAR-SEM-CI` com job `confirmar`), §1.8/§1.9/§1.10 (tabela "Fora dos
planos" na cronologia; linha do 14A agora com #29/#31), caps. 2, 6, 8 (D8 diária, lacuna 27, lacuna 12 resolvida) e
README (glossário, divergência #102). Sem mudança para o manual do usuário nem para `conteudo.ts`. A divergência do
§4.1.1 (/admin "Consultas no mês") foi corrigida no commit `2500508` desse branch.

**Manual do usuário — Plano 12** (exames do paciente + sessão da equipe 30 min/8 h): proposta entregue em 08/10/2026 em
`.superpowers/sdd/2026-10-08-plano13-preparacao/manual-usuario-plano12.md` do worktree `nutridebby-plano13` (main `3b59c38`);
aplicação com quem orquestra. Cap. 11 do técnico ainda diz "sem merge" e erra o 404 de `/p/exames` (só a API recusa).
Guia `configuracoes` v3 não cita a seção de exames (`data-guia="exames-app"` sem passo).

**Manual do usuário — Planos 13, 16 e 14A + hotfix de exames de 09/10** (parecer/retificação, /admin com abas e página
da conta, app do paciente G, peso oculto, autorização de IA, lista de exames que se atualiza): proposta entregue em
09/10/2026 no scratchpad da sessão (não versionada), base `main` `23d41b5` (cópia `nutridebby-ci-guarda`). Inclui a
Parte 2 "o que deixa de valer" (portal de 7 abas, tabela antiga do /admin, ciência de IA do Plano 11, textos do Plano 12)
e blocos A–F do roteiro. Aplicação com quem orquestra. Divergência do §4.1.1 (lista do /admin) corrigida em `2500508` (branch `runner-proprio`).

**Manual do usuário — atualização do PR #31** (textos 1.0 da IA, Anthropic EUA com guarda de 30 dias, prazo de guarda
contado do bloqueio, migration 0110): nova versão da proposta acima entregue em 09/10/2026 no scratchpad da sessão
(`manual-usuario-p13-p16-p14a-pr31.md`, não versionada), base `main` `944cd71`. Seção nova 1.10 "Prazo de guarda" e
bloco G do roteiro. Aplicação com quem orquestra. Divergência do §4.1.1 do técnico continua em `944cd71`.
Revisada no mesmo dia com 5 achados (todos aplicados): perfil completo como condição do bloco de IA no app, exceções da
guarda (2 anos se sinalizado, revisão humana) em todo resumo de "30 dias", envios à IA na cópia dos dados, retirada vale
daí em diante (fila cancelada; app/link por job `ia-retirada`). Lição: nunca resumir a guarda do fornecedor só como
"até 30 dias".

**Manual do usuário** (Claude Docs XgD7ujxhUajihUXa4Qf7yc): proposta do Plano 11 entregue em 07/10/2026 em
`.superpowers/sdd/2026-10-07-fechamento-11/manual-usuario-proposta.md` do worktree `nutridebby-fech11`; aplicação
fica com quem orquestra (não confirmada).

**Manual guiado** (`src/modules/ajuda/conteudo.ts`): `configuracoes` v3 (seção de ajuda da IA, sem passo para
`ia-secao`; dois textos divergem da tela, P11-20 g → `versao` 4 quando corrigir); `prontuario` v1 com a pergunta da IA sem subir versão.

**Plano 14B-1 (modelos sugeridos)** — revisão da T5F em 10/10/2026 (worktree `nutridebby-plano14b`, `ba299fa..5f47237`,
relatório `.superpowers/sdd/2026-10-10-nutridebby-14b1-modelos/review-task-5F-c.md`): §10.12 fiel; 4 Important (cronologia
§1.10 sem 14B-1 e 14A "em execução"; §2.7 sem `ia_geracoes_modelos`; linhas deslocadas pela 14B-1; texto do guia
`modelos` "aparecem para os pacientes"). Roteiro do manual do usuário da 14B-1 ainda a montar (rascunho no task-5F-report).

**Why:** o fechamento de cada plano parte do estado anterior; saber a base evita reconferir tudo.
**How to apply:** no próximo fechamento, `git diff 2efa27b..<head>` e comece pelos capítulos tocados; confira se a
proposta do usuário do Plano 11 foi aplicada. Ver [[onde-os-manuais-envelhecem]].
