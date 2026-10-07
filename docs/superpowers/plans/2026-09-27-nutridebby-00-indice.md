# NutriDebby MVP — Índice dos planos de implementação

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.2, aprovada) + [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md)

O MVP tem 6 módulos e 46 histórias, então foi dividido em **8 planos sequenciais**. Cada plano entrega software que funciona, com testes, e é publicado em produção ao final. Cada plano é escrito **em detalhe só quando o anterior terminar**, porque os planos seguintes consomem nomes, tipos e padrões reais do código já existente, e não suposições.

## Sequência e dependências

```
01 Fundação ──► 02 Plataforma ──► 03 Pacientes & prontuário ──┬─► 04 Plano alimentar ──┐
                                                             │                       ├─► 06 Portal PWA ──► 07 Conteúdo ──► 08 Go-live
                                                             └─► 05 Agenda & lembretes ┘
```

Os planos 04 e 05 são independentes entre si e podem ser feitos em qualquer ordem.

| # | Plano | Histórias / requisitos | Entrega verificável |
|---|---|---|---|
| **01** | [Fundação](2026-09-27-nutridebby-01-fundacao.md) | US-002 (base), US-003, US-006; RNF-04 (health), RNF-06 (senhas, rate limit), RNF-07, RNF-11; §4.1, §9.1–9.7 | Repositório com CI verde (lint, tipos, unitários, **teste de isolamento RLS**); admin criado por CLI faz login com 2FA em `app.<dominio>`; worker com heartbeat; deploy automático via GHCR → Easypanel |
| **02** | [Plataforma (M1)](2026-09-28-nutridebby-02-plataforma.md) | US-001, US-004, US-005, US-007; INT-02, INT-06; RN-15, RN-18; RNF-05 (backup), RNF-13 | Admin cria e suspende nutricionistas; convite + DPA; marca; auditoria; uploads com URL assinada e cota; e-mail (Mailpit/Resend); **backup diário no R2 funcionando antes de entrar qualquer dado real** |
| **03** | [Pacientes & prontuário (M2)](2026-09-29-nutridebby-03-prontuario.md) | US-010 (sem WhatsApp), US-011, US-012 a US-019; RN-14, RN-17; Apêndice A | Nutricionista cadastra e convida paciente; anamnese; antropometria e gasto energético com os casos de teste do Apêndice A; exames; evolução; LGPD (exportar/bloquear/anonimizar) |
| **04** | [Plano alimentar (M3)](2026-10-01-nutridebby-04-plano-alimentar.md) | US-020 a US-026; INT-04; RN-01, RN-02; P-10 | Seed TACO + medidas IBGE; montar, calcular, versionar e publicar plano; PDF gerado pelo worker |
| **05** | [Agenda & lembretes (M4)](2026-10-01-nutridebby-05-agenda-lembretes.md) | US-030 a US-037, US-010 (convite WhatsApp); INT-01 (pela Evolution API, decisão do dono em 2026-10-01), INT-03 (envio); RN-03 a RN-06, RN-09, RN-16 | Agenda; agendamento pelo paciente e pela página pública; lembretes por e-mail, WhatsApp e push; confirmação por resposta "1"/"2" e pelo link da consulta; cota |
| **06** | [Portal do paciente (M5)](2026-10-03-nutridebby-06-portal-paciente.md) | US-040 a US-046; INT-03 (inscrição); RNF-09, RNF-10 | PWA instalável, offline para o plano, push, diário com foto, evolução, lista de compras, dados do titular — **em produção** (PR #8, deploy em 03/10/2026; spec v1.9) |
| **07** | [Biblioteca de conteúdo (M6)](2026-10-04-nutridebby-07-conteudos.md) | US-050 a US-056; INT-05; RN-10 a RN-12 | Vídeos, receitas com cálculo, orientações, audiência no banco, aba Conteúdos, aviso de conteúdo novo, métricas — **em produção** (PR #10, deploy em 04/10/2026, migrations 0081–0084; spec v1.10) |
| **08** | [Go-live](2026-10-04-nutridebby-08-go-live.md) | RNF-01, RNF-02 (k6), RNF-05 (teste de restauração), RNF-10 (auditoria axe), RNF-11 (Sentry); CS-01 a CS-03; job de retenção LGPD; P08-10 (manual guiado) | Sentry com filtro, CSP e cabeçalhos, RLS final, métricas de sucesso, visual V2 do painel (claro/escuro), manual guiado, pilha de carga e teste de restauração prontos — **em produção, menos a Tarefa 8** (PR #12, deploy em 04/10/2026, migrations 0085–0088; spec v1.11). **MVP completo no código.** Os textos legais (P08-06, Tarefa 8) estão bloqueados no E-09 e viram um PR curto; o go-live da Debby (checklist assinado, P08-09) depende do dono: backup no host, Sentry e monitor, textos legais, teste no celular, rodada de carga e validação com a Debby (backlog, "Antes do go-live (dono)") |

## Pós-MVP — roadmap aprovado pelo dono em 05/10/2026

Fases pequenas, cada uma com o próprio plano (escrito só quando a anterior fechar, como no MVP) e a spec do escopo novo correspondente (`../specs/2026-10-03-*`, v0.2/v0.3). Antes de cada plano, a spec é conferida contra o código e o dono decide só as pendências daquela fase.

```
09 Fechamento do MVP ──► 10A Receita ──► 10B Assinatura gov.br/ICP ──► 11 Base de IA + laudos ──► 12 Paciente envia exames ──► 13 Parecer ──► 14 IA da nutricionista ──► 15 IA Nutri do paciente
                                                                    (loja: projeto à parte, nada a construir agora)
```

| # | Plano | Escopo | Spec | Situação |
|---|---|---|---|---|
| **09** | [Fechamento do MVP](2026-10-06-nutridebby-09-fechamento-mvp.md) | Itens técnicos **P09-01 a P09-05** (origem no salvamento do plano, worker espera o schema e reinício do 2FA pelo admin, aviso de outro papel, E2E estável, painel instalável): **entregues no PR do branch `plano-09-fechamento-mvp`, aguardando merge (merge = deploy, com o OK do dono)**. Seguem abertos: **P09-00** (textos legais P08-06, débitos Minor, validação com a Debby P08-08, dependem do E-09) e **P09-06** (Status do sistema) | MVP v1.11 | Itens 01–05 entregues, aguardando merge |
| **10A** | [Receita (base de documentos assinados + assinatura digitalizada)](2026-10-05-nutridebby-10a-receita.md) | F3-06: US-140, US-142 a US-147 com a assinatura **digitalizada** (opção E), US-149 (cancelar) e a base da US-150 (LGPD): perfil profissional, receita, PDF com código e QR, fotos assinadas à mão → PDF novo no worker, entrega (portal, link + código, pessoalmente), recebimento, verificação pública, exportação e anonimização | [Documentos assinados v0.4](../specs/2026-10-03-nutridebby-documentos-assinados-design.md) | **Concluído em 06/10/2026** — **em produção** (PR #19, migrations 0089–0093; spec de documentos v0.4 e spec do MVP v1.12 no fechamento); 16 tarefas; decisões ★ D1–D6 e D9 aprovadas em 05/10/2026; não depende do 10B; o interruptor "Documentos" nasce desligado — liberação para uso real: consulta ao CRN-3, textos, termo/DPA e backup no host (checklist do go-live); Minors em P10A-18 a P10A-21 |
| **10B** | [Assinatura gov.br e ICP-Brasil](2026-10-05-nutridebby-10b-assinatura-digital.md) | F3-06, parte do certificado: spike (P-B2), conferência do PDF assinado sem rede (RN-144), assinante do consultório e troca do CPF (RN-145), envio do PDF assinado (US-144) | Documentos assinados v0.4 | **Aprovado pelo dono (05/10/2026)** — 5 tarefas + 1 condicional; decisões ★ D7, D8 e D9 aprovadas; depende do 10A (concluído) e dos PDFs reais assinados do dono (spike); migrations a partir da **0094** |
| **11** | [Base de IA + leitura de laudos](2026-10-06-nutridebby-11-ia-laudos.md) | F3-01 (Subprojeto A, E10 e E11: US-100 a US-104 e US-110 a US-112 — provedor trocável com a Messages API direta, cota em US$ por consultório e teto da plataforma, ciência do paciente e "Não usar IA", aditivo de IA, liberação pela admin, leitura de laudos com conferência linha a linha, avaliação com laudos fictícios) | [IA da nutricionista v0.3](../specs/2026-10-03-nutridebby-ia-nutricionista-design.md) | **Plano 11 escrito (06/10/2026)** — 17 tarefas (13 com revisão completa, 4 leves); migrations a partir da **0098** (`0098`–`0099`); decisões do dono A-D1/2/4/5/6/7/9/10/14/15/16/19/20 aplicadas (spec v0.3); ★ ainda do dono: D12 (modelo, com a avaliação), D13 (textos com o advogado), D14 (liberação para uso real), D15 (sinônimos com a Debby); dado real só depois da ZDR, do advogado e da avaliação (runbook). Próximo passo: `/code-review high` do plano → execução |
| **12** | Paciente envia exames | F3-04 (Subprojeto C, parte de exames) | [Exames e IA do paciente v0.2](../specs/2026-10-03-nutridebby-paciente-exames-ia-design.md) | A escrever |
| **13** | Parecer nutricional | F3-05: US-141, US-148 a US-150 (parecer, retificar, cancelar se não subir para o 10, LGPD do parecer); D2 com a resposta do CRN-3 | Documentos assinados v0.3 | A escrever |
| **14** | IA da nutricionista | F3-03 (Subprojeto A, E12; decisões A-D3, A-D8, A-D11, A-D12, A-D13, A-D17, A-D18) | IA da nutricionista v0.3 | A escrever |
| **15** | IA Nutri do paciente | F3-02 (Subprojeto C, parte de IA) | Exames e IA do paciente v0.2 | A escrever |
| — | Loja (F4-01) | Projeto à parte (decisão do dono); nada a construir agora | [Viabilidade da loja](../specs/2026-10-03-nutridebby-loja-viabilidade.md) | Fora do roadmap |

**Registro do processo — Plano 06:** a execução usou **workflow** com tarefas paralelas: depois das Tarefas 1–5 em sequência, as Tarefas 6–13 rodaram com revisão sobreposta, e as Tarefas 8, 9, 10 e 12 em worktrees paralelos, integradas por cherry-pick no branch do plano. A revisão por tarefa foi em **lentes** (spec/qualidade e segurança/LGPD) com três verificadores adversariais, até duas rodadas de correção; a revisão final do branch, em seis lentes com verificação adversarial; depois, o `/code-review high` uma vez, a re-revisão só do diff das correções (também em lentes), uma auditoria de segurança em seis lentes e o `/security-review`. Resultados no fim do plano ("Resultado da entrega").

**Registro do processo — Plano 07:** varredura prévia do plano contra a `main` (11 decisões, R1–R11, por cima do texto: base no PR #11, ordem das tarefas, testes e guardas) e execução por **workflow** (57 agentes): depois da Tarefa 1, as Tarefas 2, 3, 4 e 8 em worktrees paralelos, integradas no branch do plano; revisão por tarefa em duas lentes (spec/qualidade e segurança/LGPD), com uma rodada de correção nas Tarefas 1, 4 e 13; revisão final do branch em quatro lentes (banco, painel e arquivos, portal, LGPD e testes) com uma onda de correções; depois, o `/code-review high` uma vez (no plano, antes da execução, e no código), a re-revisão só do diff das correções e o `/security-review` com o checklist reforçado (D21). Resultados no fim do plano ("Resultado da entrega").

**Registro do processo — Plano 08:** decisões ★ do dono (16) e `/code-review high` **do plano** (10 achados, corrigidos no texto) antes da execução; execução por **workflow** (157 agentes, ~6,5 h) em **duas frentes paralelas** — operação e segurança (Tarefas 1–11) no branch do plano e visual e manual (Tarefas 12–16) num worktree, integrado antes da Tarefa 17 —, com a Tarefa 8 fora (E-09); revisão por tarefa em duas lentes, com até duas rodadas de correção; revisão final do branch em **seis lentes** (observabilidade, segurança web, banco e LGPD, visual e acessibilidade, manual, operação e docs) com uma onda de correções (5 Important); depois, o `/code-review high` uma vez **no código** (10 achados corrigidos), a re-revisão só do diff das correções e o `/security-review` com o checklist reforçado — a revisão geral final do MVP (P08-05). Resultados no fim do plano ("Resultado da entrega").

**Registro do processo — Plano 10A:** plano único (Plano 10, 19 tarefas) dividido pelo dono em 10A e 10B (05/10/2026), com o `/code-review high` **do plano** antes da execução (PR #18); execução por **workflow** em etapas, com as Tarefas 4 ‖ 5 e 11 ‖ 12 em worktrees paralelos; revisão por tarefa em 2–3 lentes nos papéis dos agentes especialistas (`revisor-rls`, `normas-cfn-lgpd`, `revisor-interface`), três verificadores adversariais por achado e até duas rodadas de correção; revisão final do branch em **seis lentes** com uma onda de correções (2 Important de testes e 7 Minors de segurança; migration 0092); depois, o `/code-review high` uma vez no PR #19 (3 Important e 6 achados corrigidos; migration 0093), a re-revisão só do diff das correções (sem Critical/Important) e o `/security-review` com o checklist reforçado (D9 ★; nenhum achado mantido). `pnpm test` com 244 arquivos e 2244 testes. Fechamento (06/10/2026): spec de documentos v0.4, spec do MVP v1.12, manual técnico (cap. 9) e os Minors no backlog (P10A-18 a P10A-21).

## Trilha paralela — tarefas fora do código (começar já)

Estas tarefas não dependem de código, e algumas levam dias por dependerem de terceiros. Cada uma indica o plano que precisa dela pronta.

| ID | Tarefa | Responsável | Necessária até |
|---|---|---|---|
| E-01 | Criar repositório privado no GitHub e **corrigir o token do MCP do GitHub** | Você | Plano 01 |
| E-02 | Definir nome do produto e domínio; apontar `app.<dominio>` (registro A) para o IP da VPS | Você | Plano 01 (deploy) |
| E-03 | Criar o projeto `nutri` no Easypanel com os serviços `nutri_app`, `nutri_worker` e `nutri_db` (o plano 01 detalha a configuração de cada campo no painel) | Você, pelo painel | Plano 01 (deploy) |
| E-04 | **Verificação da Meta Business** + app WhatsApp Cloud API + número dedicado + envio dos 3 templates (§6 INT-01) | Você | Plano 05 (**começar primeiro: leva dias**) |
| E-05 | Conta no Resend + verificação do domínio (SPF, DKIM, DMARC) | Você | Plano 02 |
| E-06 | Bucket privado no Cloudflare R2 + chave com escopo só nesse bucket; site key e secret do Turnstile | Você | Plano 02 |
| E-07 | Conta no Sentry | Você | Plano 08 |
| E-08 | Debby: lista dos ~150 alimentos mais usados, taxa de faltas atual, validação das fórmulas do Apêndice A | Debby | Planos 03, 04 e 08 |
| E-09 | Advogado: texto do termo do paciente, DPA e prazo de guarda do prontuário (P-01, P-02) | Você + advogado | Plano 08 |
| E-10 | VPS: criar 2 GB de swap; instalar ~~`postgresql-client-16`~~ e `rclone` no host (**cada item com sua confirmação**, pela regra do servidor) — o `postgresql-client-16` não é mais necessário (Plano 08, D6: a restauração usa um container descartável) | Claude, após seu OK | Plano 02 |

## Revisão obrigatória a cada entrega (decidido em 2026-09-27, revisto em 2026-10-02)

O desenvolvimento é autônomo, então cada entrega passa por revisões com funções diferentes, mais uma revisão de segurança:

| Etapa | Quando | O que é |
|---|---|---|
| 1 | A cada tarefa, durante a execução | Revisor independente (workflow com lentes e verificação adversarial, quando possível) confere aderência à spec e qualidade do código antes da próxima tarefa |
| 2 | Fim de cada plano, sobre o branch inteiro | Revisão final por workflow; uma onda de correções e re-revisão do diff das correções |
| 3 | Sobre o PR | `/code-review` em nível `high` **uma vez**, como segunda opinião; o que for Critical/Important é corrigido, Minor vai para o backlog |
| 4 | Depois das correções da etapa 3 | Re-revisão **só do diff das correções** (não do PR inteiro) |
| Segurança | Todo plano, sobre o PR | `/security-review`. Nos Planos 01, 02, 03, 05, 06, 07 e 08, com checklist reforçado: RLS e isolamento por paciente, LGPD, uploads, autenticação, webhook do WhatsApp, páginas públicas e links assinados. Revisão geral final em P08-05 (feita no Plano 08: 0 achados) |

- **Por que mudou (2026-10-02):** a 2ª rodada completa de `/code-review high`, exigindo "sair limpo", não convergia em diffs grandes (os Planos 03 e 04 precisaram de aprovação do dono para encerrar): revisar ~10 mil linhas de novo sempre amostra trechos novos e acha novos Minors. A re-revisão do diff das correções é o que confirma que a correção está certa.
- **Critério de parada:** merge só com CI verde, a re-revisão da etapa 4 e a revisão de segurança sem Critical/Important confirmado. Se ainda houver, o desenvolvimento **para e escala para o dono do produto**; nada de rodadas extras sem aviso.
- **Merge = deploy em produção = reinício de serviço:** exige confirmação explícita do dono do produto (regra 3 do CLAUDE.md do servidor). A autonomia vai até o PR revisado e pronto.
- **Sem custo extra:** todas as revisões rodam na assinatura do dono (`/code-review` e `/security-review` locais). O `/code-review ultra` (cobrado à parte) **não é usado** neste projeto.
- O resultado de cada rodada fica registrado no PR (resumo dos problemas encontrados e corrigidos).

## Convenções para todos os planos

- Branch por plano (`plano-01-fundacao`, …), PR para `main`, CI verde antes do merge. Merge na `main` = deploy.
- Toda tabela nova com `tenant_id` entra na lista do teste de isolamento (Plano 01, Tarefa 5). Esquecer uma tabela quebra o CI de propósito.
- Mensagens de interface e de erro em pt-BR, com o texto exato da spec.
- Configuração de serviço (variáveis, domínio, imagem, volumes) muda **pelo Easypanel**, nunca por `docker service update` (regra do servidor).
