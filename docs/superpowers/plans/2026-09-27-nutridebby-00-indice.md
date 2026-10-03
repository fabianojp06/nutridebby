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
| **06** | [Portal do paciente (M5)](2026-10-03-nutridebby-06-portal-paciente.md) | US-040 a US-046; INT-03 (inscrição); RNF-09, RNF-10 | PWA instalável, offline para o plano, push, diário com foto, evolução, lista de compras, dados do titular |
| 07 | Biblioteca de conteúdo (M6) | US-050 a US-056; INT-05; RN-10 a RN-12 | Vídeos, receitas com cálculo, orientações, audiência, aba Conteúdos, métricas |
| 08 | Go-live | RNF-01, RNF-02 (k6), RNF-05 (teste de restauração), RNF-10 (auditoria axe), RNF-11 (Sentry); CS-01 a CS-03; job de retenção LGPD | Checklist de go-live assinado; Debby em produção |

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
| E-10 | VPS: criar 2 GB de swap; instalar `postgresql-client-16` e `rclone` no host (**cada item com sua confirmação**, pela regra do servidor) | Claude, após seu OK | Plano 02 |

## Revisão obrigatória a cada entrega (decidido em 2026-09-27, revisto em 2026-10-02)

O desenvolvimento é autônomo, então cada entrega passa por revisões com funções diferentes, mais uma revisão de segurança:

| Etapa | Quando | O que é |
|---|---|---|
| 1 | A cada tarefa, durante a execução | Revisor independente (workflow com lentes e verificação adversarial, quando possível) confere aderência à spec e qualidade do código antes da próxima tarefa |
| 2 | Fim de cada plano, sobre o branch inteiro | Revisão final por workflow; uma onda de correções e re-revisão do diff das correções |
| 3 | Sobre o PR | `/code-review` em nível `high` **uma vez**, como segunda opinião; o que for Critical/Important é corrigido, Minor vai para o backlog |
| 4 | Depois das correções da etapa 3 | Re-revisão **só do diff das correções** (não do PR inteiro) |
| Segurança | Todo plano, sobre o PR | `/security-review`. Nos Planos 01, 02, 03 e 05, com checklist reforçado: RLS e isolamento por paciente, LGPD, uploads, autenticação, webhook do WhatsApp, páginas públicas e links assinados. Revisão geral final em P08-05 |

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
