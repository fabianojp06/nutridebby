# Plano 26 — Relatórios e recepcionista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista ganha uma área **Relatórios** (pacientes, atendimentos, planos alimentares, agenda, financeiro e ranking, por período de até 12 meses e, com o Plano 23, por local, com CSV e impressão em PDF pelo navegador) e pode convidar até 3 pessoas de **recepção**, que entram com 2FA e termo de confidencialidade e trabalham na agenda e no cadastro — e no Financeiro, com a permissão — sem nunca ler uma linha de tabela clínica, nem a observação do cadastro, nem paciente bloqueado.

**Architecture:** PR 1 é só aplicação: `src/modules/relatorios/` agrega no SQL, numa transação por seção, e grava o `exportar` (sem paciente, ou um por paciente no Ranking) na transação da leitura. PRs 2 e 3 criam o papel `recepcao` com **negação por padrão em duas camadas**: no banco, `recepcao_negada` (RESTRICTIVE) nasce em toda tabela com `tenant_id` pelo `app_enable_tenant_rls` (corpo da 0070 + `app_deny_recepcao`) e por um laço sobre as existentes; só as tabelas de `RECEPCAO_LIBERADO` ganham comandos, com as condições `recepcao_cond_*` (paciente visível, financeiro, notificações da agenda, própria linha) e gatilhos de colunas por lista branca; no app, `requireNutri` não muda e só as rotas de `ROTAS_DA_RECEPCAO` chamam `requireEquipe`. As guardas `findRecepcaoViolations` e `findPapelEmFuncoesViolations` e o teste de fonte das rotas quebram o CI quando algo novo fica sem decisão. Marcos de retorno e a guarda "tem atendimento" chegam à recepção por funções `SECURITY DEFINER` que devolvem só o selo, a previsão e o booleano. A recepção responde os pedidos de paciente cadastrado do 23 (o PR 2 refaz `app_appointments_regras_pedido`); os de pessoa nova ficam com a nutricionista (RE-D59). Fora do painel, `/inicio`, `/conta/outro-papel` e `/api/sessao/ativa` aceitam o papel (RE-D67).

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, layouts, `cache`, Server Actions e Route Handlers) · Drizzle · PostgreSQL 16 (RLS) · Better Auth · pg-boss · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-nutridebby-26-relatorios-recepcionista-design.md` **v0.3** (painel de revisão aplicado, §18; revisão do plano, §18.5; decisões RE-D1 a RE-D48 e RE-D59 a RE-D69). Backlog Paridade Dietbox, onda 3: PD-100 (relatórios) e PD-101 (recepcionista). Numeração do bloco 480–519. As decisões de execução deste plano (RE-D49 a RE-D58) vão para a spec no fechamento (T12); as da revisão do plano que mudam regra (RE-D59 a RE-D69) já estão na spec §14. Plano conferido contra a `main` 07756c4, `origin/plano-20-financeiro` (411f21d) e os worktrees da onda em 17/11/2026 (ver "Conferência do plano contra o código").

## Ambiente da sessão

| Item | Valor |
|---|---|
| Worktree | a sessão de código que a orquestradora liberar (A, B ou C), criada por `scripts/sessao-paralela.sh <x> plano-26-relatorios-recepcionista`. O worktree `../nutridebby-26` (onde a spec e este plano foram escritos) é só de documento e sai antes (`git worktree remove ../nutridebby-26`, com a árvore limpa): o mesmo branch não fica em dois worktrees (RE-D49) |
| Branch | `plano-26-relatorios-recepcionista` (base `origin/main` 07756c4). PR 1 sai de `plano-26-relatorios`, PR 2 de `plano-26-recepcao-fundacao`, PR 3 de `plano-26-recepcao-telas`, cada um criado do anterior depois do merge (ver "Ordem de entrega") |
| Porta e banco | os da sessão (`310x`, `nutri_dev_x`, `sessoes-paralelas.md` §3); `pnpm exec next dev -p 310x`, nunca `pnpm dev` |
| Variáveis | nenhuma `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `APP_URL` ou `DATA_DIR` exportada; conferir só os nomes: `env \| cut -d= -f1 \| grep -E '^(DATABASE_URL\|APP_URL\|DATA_DIR)'` |
| Olhar o banco | `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_x`; **nunca** produção (regra 5), nem por subagente |
| E2E | `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:310x pnpm test:e2e <spec>`; parar o `pnpm worker` da sessão antes; um E2E por vez entre as sessões (Mailpit único). Bloco de IP **`10.9.36.x`** (o `10.9.26.x` já é do `e2e/portal.spec.ts`; RE-D50) |
| Vitest | `pnpm vitest run <arquivos>` (Testcontainers); escalonar com as outras sessões |

Proibido: tocar produção (nem leitura), `docker service update`, push sem OK, merge sem OK do dono (merge = deploy), editar outros worktrees, `nutri-backup.sh`.

## Global Constraints

- Regras 1, 2, 3, 7, 8 e 9 do `CLAUDE.md`. Toda consulta a tabela com `tenant_id` por `withTenant(ctx, fn)` com `actorUserId` e `ip`; o admin nunca consulta. Cada função dos Relatórios confere `podeVerSecao` **antes** de abrir a transação; cada função liberada à recepção confere o papel antes (`exigirEquipe`, `exigirFinanceiro`), nunca confia só na RLS (vazio calado não é recusa).
- **Migrations só no PR 2:** uma gerada (`pnpm db:generate --name recepcao`, sem edição à mão) e uma custom (`pnpm drizzle-kit generate --custom --name rls_recepcao`), com `DATABASE_URL_MIGRATOR` (regra 7). Número = o que o `db:generate` der sobre a `main` do momento; **nada reservado**. Antes de abrir o PR 2 (e de novo se outra migration entrar antes), `sessoes-paralelas.md` §5, passos 1 a 8, **trocando na custom os corpos copiados pelos da `main` do momento**: `app_enable_tenant_rls` (hoje o da 0070), `fin_lancamentos_regras` (0123 ou o do 20 PR 2/3), `app_appointments_regras_pedido` (o da 0131 do 23 PR 1, ou o mais novo; RE-D59) e o CHECK de `notifications.tipo` (para conferir `TIPOS_DA_AGENDA`). Depois: `pnpm drizzle-kit check`, `grep -rn "<número antigo>" src test docs CLAUDE.md`, recriar o `nutri_dev_x` (com OK do dono) e `pnpm vitest run src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/db/recepcao-banco.test.ts`. O `migrate-owner.test.ts` é o único com dono **sem** superusuário: é nele que as funções `SECURITY DEFINER` são provadas.
- **`lock_timeout` na conexão do migrador** (RE-D64): `src/db/migrate.ts` abre o `Pool` com `options: '-c lock_timeout=10s'`; a custom **não** tem `SET LOCAL lock_timeout` (o limite vale para a execução inteira, inclusive a migration gerada e os blocos 3 a 5).
- **Expansão, nunca contração** (RNF-486): o CHECK de `user` e o de `invites` só ganham valor; colunas novas anuláveis; as políticas novas só pegam a sessão `recepcao`. A imagem anterior ao PR 2 roda sobre o banco do PR 2.
- **Negação por padrão** (RE-D15, RE-D16): nenhuma tabela, página, action ou rota fica liberada à recepção sem entrada em `RECEPCAO_LIBERADO` ou `ROTAS_DA_RECEPCAO`. `requireNutri`/`requireApiNutri` **não mudam**.
- **Falha fechada** (RE-D40, RE-D62): na sessão da recepção, paciente não achado é "não encontrado" ou 42501, nunca "não bloqueado"; guarda de módulo que lê tabela negada à recepção (como `consultations` em `registrarPresenca`) volta vazia e passaria calada — vira função `SECURITY DEFINER` booleana (molde 0083) ou recusa. Nenhuma função de `FUNCOES_DA_RECEPCAO` (nem do módulo de pacientes e do Financeiro chamados pela recepção) faz `from(<tabela negada>)` (teste de fonte da T10).
- **Envio de link ao paciente** (RE-D37, RE-D60): todo envio a `patients.email` iniciado pela nutricionista (convite, assinatura com entrega por link, "Reenviar link por e-mail", pedido de autorização de IA por e-mail) mostra o e-mail antes de confirmar.
- **Projeções da recepção** com teste das chaves: nunca `observacao`, `identidade_genero`, `peso_oculto_no_app_em`, colunas `ia_*`, `motivo` de bloqueio, `motivo_cancelamento`, `token_hash`, `codigo_hash`, `ip`, `tentativas` (RNF-484 h). Nenhum `select()` nem `.returning()` sem colunas de `patients`, `patient_cadastro`, `appointments`, `availability_blocks`, `notifications` ou `fin_lancamentos` num caminho que a recepção alcança (guarda de fonte da T9; `criarPaciente`/`atualizarPaciente` devolvem hoje a linha inteira, com `ia_*` e `peso_oculto_no_app_em`). `public_booking_requests` é negada à recepção (RE-D59).
- **Auditoria** (regra 8, RN-493, RN-516): agregado sem `auditRead`; CSV e impressão gravam `exportar` na transação da leitura (sem paciente; no Ranking, uma linha por paciente); a recepção grava e lê auditado como a nutricionista, com o ator; ações da Equipe na entidade `equipe`, sem paciente.
- **Privacidade (regra 3, RN-497, RNF-482):** números, nomes, e-mails da equipe, valores, categorias e local nunca em log, Sentry ou mensagem de erro; o convite loga só ids.
- **Datas** no fuso do consultório; meses em `src/modules/relatorios/periodo.ts`, que só **importa** de `src/modules/agenda/fuso.ts` (C-483: não editar `fuso.ts`).
- **Sem arquivo novo e sem dependência nova** (C-481, C-482): PDF pela impressão do navegador; barras em HTML/CSS com classes de token.
- **Guia junto com a página** (`src/modules/ajuda/conteudo.test.ts`, "tem guia ou está em SEM_AJUDA"): a tarefa que cria um `page.tsx` em `/painel` põe o `padrao` de um guia ou a entrada justificada em `SEM_AJUDA` **na mesma tarefa**; o guia `equipe` fica antes do `configuracoes` no array (a regex `configuracoes(/.*)?` engoliria a rota). Cada `page.tsx` novo entra em `ROTAS_DO_PAINEL` (`e2e/painel-rotas.ts`, guarda `rotas-axe.test.ts`) na mesma tarefa.
- **Textos** em pt-BR, exatos da spec §6.2, em `MSG_RELATORIOS` (`src/modules/relatorios/constantes.ts`), `MSG_EQUIPE` e `MSG_RECEPCAO` (`src/modules/plataforma/equipe-textos.ts`); os rótulos que um guia cita entre aspas existem num `.tsx` ou nesses módulos (`TSX_FORA` de `conteudo.test.ts`). Textos neutros em gênero para a pessoa da recepção.
- **Arquivos disputados** (`sessoes-paralelas.md` §6) — só acrescentar, no fim da lista ou do bloco, no formato que a `main` tiver no rebase: `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `src/db/migrate-owner.test.ts`, `CLAUDE.md`, `src/db/tenant.ts`, `src/app/painel/configuracoes/page.tsx` (`CARTOES`), `src/modules/notificacoes/tipos.ts`, `src/email/{types.ts,templates.tsx}`, `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`), `scripts/e2e-seed.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade*.spec.ts`, `src/modules/ajuda/conteudo.ts` (e testes), `src/app/formularios-post.test.ts`, `next.config.ts`, `docs/manual-tecnico/`, `.claude/agent-memory/**`.
- **`CLAUDE.md` no rebase:** cada regra é uma linha física; ficar com a linha da `main` e reacrescentar só as frases "Plano 26" nas regras 1, 2 e 8; conferir `grep -c "Plano 2[0-9]" CLAUDE.md` antes e depois (não pode cair).
- **Não mudar assinaturas do Plano 20 PR 2 nem do 23:** `registrarPresenca` → `{ cobranca }`, `registrarAtendimento` → `{ id, cobranca }`; as funções da agenda do 23 só ganham o papel aceito. `cobranca.ts` e `cobranca-actions.ts` continuam só da nutricionista (RE-D61).
- **Sessão fora do painel** (RE-D67): todo `requireUser(`/`requireApiUser(`/`lerSessaoApi(` fora de `src/app/painel` e `src/app/api/painel` tem a decisão explícita para `recepcao` (guarda de fonte da T6).

## Review Focus

1. **Negação por padrão sem buraco** — `app_enable_tenant_rls` com o corpo da 0070 (sem perder `paciente_sem_*`), o laço só no schema `public`, a guarda que exige RESTRICTIVE e o comando em cada `recepcao_*`, o teste numa tabela de rascunho. T4.
2. **Paciente escondido e tabela negada** — `recepcao_cond_paciente_visivel` nas tabelas filhas, `NOT FOUND` → 42501 em `fin_lancamentos_regras`, módulos com falha fechada (`travarLancamento`, `travarPacienteDaConsulta`, `carregarPacienteParaEscrita`), "Faltou com atendimento" por `app_consulta_tem_atendimento` (RE-D62). T5a, T5b, T10, T11b.
3. **E-mail e convite** — gatilho de `patients` sem `email` no UPDATE da recepção; `criarPaciente` sem convite na sessão dela; a confirmação do e-mail antes de todo envio de link da nutricionista (convite, assinatura, reenviar link, autorização de IA; RE-D60). T5b, T9.
4. **Listas brancas dos gatilhos** — `patients` (inclusive `user_id`), `patient_cadastro` (`observacao`, `identidade_genero`), `appointments` (INSERT no estado final, `patient_id`, `origem`, `cancelado_por` com `pedido_recusado` só saindo de `solicitada`), `app_appointments_regras_pedido` refeito com o corpo da `main` (RE-D59). T5b.
5. **Rotas** — teste de fonte por action exportada; página liberada que no meio lê o prontuário ou mostra link para ele (consulta, lista, cancelamento). T6, T9, T10.
6. **Peças `SECURITY DEFINER`** — `app_retorno_das_consultas`, `app_previsoes_de_retorno`, `app_consulta_tem_atendimento`: troca de papel para `worker`, filtro por tenant e por paciente visível, contexto restaurado, `search_path`, `REVOKE`/`GRANT`, só o selo, a previsão e o booleano. T5b (`migrate-owner.test.ts`).
7. **Relatórios batem** — mês atual = Início e Resumo do Financeiro (CS-482); recepção = nutricionista menos bloqueados e anonimizados; agregado sem `auditRead`, exportação com o rastro certo. T2.
8. **Entrada da recepção** — `/inicio`, `/conta/outro-papel`, `/api/sessao/ativa` e a guarda de fonte fora do painel (RE-D67). T6.

## Ordem de entrega

| PR | Tarefas | Quando | Por quê |
|---|---|---|---|
| **PR 1 — Relatórios** | T1, T2, T3 | Depois do merge do 20 PR 2 (usa `resumo.ts` e `csv.ts` do 20). Sem migration: só o trem de CI | Entrega PD-100 para a nutricionista (sem a Fase B do local); `acesso.ts` já recebe o papel, mas todas as rotas chamam `requireNutri` (RE-D51) |
| **PR 2 — fundação da recepção** | T4, T5a, T5b, T6, T7, T8 | Portão (C-488): 20 PR 2 **e** 23 PR 1 na `main`; entra **por último** na fila de migrations da onda 3 (depois do PR com migration do 25) | Banco, sessão, entrada, Equipe, primeiro acesso, Início e menu da recepção. A Equipe nasce desligada (`EQUIPE_LIGADA = false`, RE-D52): em produção ninguém é convidado antes das telas de trabalho |
| **PR 3 — telas da recepção** | T9, T10, T11a, T11b | Depois do merge do PR 2 **e** do 23 inteiro (PRs 1 a 4). Sem migration (RE-D53) | Pacientes e cadastro, agenda, Fase B do local e previsões de retorno (T11a), Financeiro e Relatórios da recepção; a T11b liga `EQUIPE_LIGADA` |
| — | T12 | Fecha o plano (depois do PR 3) | Manuais, ajuda, backlog, runbook, CS-484 com a Debby |

O fechamento de cada PR (axe das rotas novas, `ROTAS_DO_PAINEL`, manual técnico do que mudou, guias com `padrao`) é o passo final da última tarefa do PR; a T12 só fecha o plano.

**Branch depois de cada merge.** O §5 regenera as migrations no `plano-26-recepcao-fundacao`; depois do merge do PR 2:

```bash
git fetch origin
git checkout -b plano-26-recepcao-telas origin/main
git cherry-pick <commits da T9 em diante, se já houver>   # nada da T4–T8 (T5a/T5b inclusive) volta
git diff origin/main -- drizzle/                         # tem de sair vazio
```

Merge sempre com OK do dono (a migration do PR 2 roda no boot); nunca das 03h às 07h30 BRT; **sem snapshot da Hostinger** (congela a VPS): migration aditiva e o backup restic diário. Runbook `docs/operacao/recepcao.md` criado na T4 (volta atrás: a imagem anterior ao PR 2 roda sobre o banco novo, e nela a recepção já é recusada — `requireUser`/`requireNutri` antigos não conhecem o papel, e as listas do admin filtram `app_role = 'nutri'`; conferir na T4 `contas.ts`, `metricas-sucesso.ts` e as telas do admin com uma conta `recepcao` no banco; "desativar pela Equipe" só vale com a imagem nova; `lock_timeout` de 10 s na conexão do migrador e o reinício do container se estourar) e completado na T11b.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/relatorios/{constantes,periodo,acesso,csv}.ts` (novos, puros) | Textos, seções, faixas etárias, limites; período e opções do `<select>`; quem vê cada seção; linhas do CSV |
| `src/modules/relatorios/{pacientes,atendimentos,planos,agenda,financeiro,ranking,registro}.ts` (novos) | Uma função por seção (uma transação, agregação no SQL); `registrarExportacao` |
| `src/modules/financeiro/{resumo,csv,erros}.ts` (20, só acrescentar) | `recebidoEPagoPorMes`, `porCategoriaNoPeriodo`; `export` do escape de célula; `exigirFinanceiro` |
| `src/app/painel/relatorios/**` (novas) | Seções, abas, filtros, impressão; `src/app/api/painel/relatorios/csv/route.ts` |
| `src/db/schema/{auth,access,equipe}.ts` | `user.ultimoAcessoEm` e CHECKs; `invites` com `recepcao`; `equipeMembros` (novo arquivo, exportado no índice do schema) |
| `drizzle/<NNNN>_recepcao.sql` (gerada) + `drizzle/<NNNN+1>_rls_recepcao.sql` (custom) | Tudo do banco da spec §9 |
| `src/db/{tenant,rls-guard}.ts`, `src/db/migrate.ts` | `TenantRole` + `recepcao`; `RECEPCAO_LIBERADO`, `RECEPCAO_CONDICOES`, `FUNCOES_COM_PAPEL` e as guardas; `lock_timeout` do migrador (RE-D64) |
| `src/lib/{session-rules,tenant-session,auth}.ts`, `src/app/inicio/page.tsx`, `src/app/conta/outro-papel/page.tsx`, `src/app/api/sessao/ativa/route.ts` | Papel, 2FA, `requireEquipe`/`requireApiEquipe`, último acesso; entrada e aviso de sessão da recepção (RE-D67) |
| `src/app/painel/rotas-da-recepcao.ts` (novo) | `ROTAS_DA_RECEPCAO` e o teste de fonte |
| `src/modules/plataforma/{equipe,equipe-textos}.ts` (novos), `convites.ts`, `textos-versionados.ts` | Equipe, convite `recepcao`, termo `sigilo-equipe-1.0` |
| `src/app/painel/configuracoes/equipe/*`, `src/app/convite/[token]/*`, `src/app/termos/sigilo-equipe/page.tsx`, `src/app/conta/{seguranca,acesso-desativado}/*`, `src/app/painel/{sem-permissao,contrato-pendente}/page.tsx` | Telas da Equipe, do primeiro acesso e de aviso |
| `src/app/painel/{layout,page,navegacao,menu-conta}.tsx\|ts`, `src/app/painel/inicio-recepcao.tsx` (novo), `src/modules/agenda/inicio-recepcao.ts` (novo), `src/modules/ajuda/conteudo.ts`, `src/app/painel/guia/*`, `src/app/painel/ajuda/page.tsx`, `src/app/painel/preferencias/actions.ts` | Painel e manual guiado por papel |
| `src/app/painel/cadastro/[id]/**` (novo), `src/app/painel/pacientes/[id]/perfil/*` (extração do formulário), `src/modules/pacientes/{pacientes,cadastro}.ts` | Cadastro pela recepção |
| `src/modules/agenda/{papel,consultas,presenca,disponibilidade,cancelamento,visoes,solicitacoes}.ts`, `src/app/painel/agenda/**` | Agenda pela recepção |
| `src/modules/documentos/*` e `src/app/painel/pacientes/[id]/documentos/**`, `src/modules/ia/autorizacao.ts` e a tela do pedido por e-mail | Confirmação do e-mail antes de cada envio de link (RE-D60; só telas da nutricionista) |
| `src/modules/financeiro/*`, `src/app/painel/financeiro/**` | Financeiro com a permissão |
| Testes novos | `src/modules/relatorios/*.test.ts`, `src/db/recepcao-banco.test.ts`, `src/app/painel/rotas-da-recepcao.test.ts`, `src/app/papeis-fora-do-painel.test.ts`, `src/app/painel/leituras-negadas.ts` (espião, R-482), `src/modules/plataforma/equipe.test.ts`, `src/modules/pacientes/recepcao.test.ts`, `src/modules/agenda/recepcao.test.ts`, `src/modules/financeiro/recepcao.test.ts`, `e2e/relatorios.spec.ts`, `e2e/recepcao.spec.ts`, `e2e/equipe.spec.ts` |

---

### Task 1: Relatórios — núcleo puro, CSV e registro da exportação (PR 1)

**Files:**
- Create: `src/modules/relatorios/constantes.ts` (`MSG_RELATORIOS` da §6.2, `SECOES`, `FAIXAS_ETARIAS` com "Menos de 18", `RANKING_LIMITE = 20`, `MESES_MAX = 12`), `periodo.ts`, `acesso.ts`, `csv.ts`, `registro.ts`
- Modify: `src/modules/financeiro/csv.ts` (só `export` do escape de célula, sem mover), `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO.relatorios = 'Relatórios'`, no fim)
- Test: `src/modules/relatorios/{periodo,acesso,csv,registro}.test.ts`, `src/modules/plataforma/audit.test.ts` (caso do rótulo)

**Interfaces:**
```ts
export type Secao = 'pacientes' | 'atendimentos' | 'planos' | 'agenda' | 'financeiro' | 'ranking';
export type Acesso = { papel: 'nutri' | 'recepcao'; financeiro: boolean };
export function secoesPermitidas(a: Acesso): Secao[];           // RN-480: recepção → pacientes, agenda (+ financeiro)
export function podeVerSecao(a: Acesso, s: Secao): boolean;
export type Periodo = { de: string; ate: string; meses: string[] }; // 'AAAA-MM'
export function periodoDaUrl(sp: URLSearchParams, hoje: string, fuso: string): { periodo: Periodo; erro: 'ordem' | 'longo' | 'invalido' | null; escolhido: { de: string | null; ate: string | null } };
export function opcoesDeMes(primeiroCadastro: string | null, hoje: string): string[]; // RE-D48: desde min(primeiro, atual − 11)
export function limitesDoMes(mes: string, fuso: string): { inicio: Date; fim: Date };    // só importa de agenda/fuso.ts
export function linhasCsv(secao: Secao, dados: unknown): string[][];                    // RN-494
export function nomeDoArquivo(secao: Secao, p: Periodo, por?: 'consultas' | 'receita'): string;
export async function registrarExportacao(tx: Tx, o: { secao: Secao; periodo: Periodo; localId: string | null; pacientes?: string[] }): Promise<void>; // RN-493
```

- [ ] **Step 0 (PM-R1):** reconferir a `main` e os branches da tabela de Coordenação (`git log -1` de cada um); anotar no PR o que mudou desde 17/11 (tabelas novas, funções com papel, tipos de notificação, itens de menu) e avisar a orquestradora se algo muda a ordem.
- [ ] **Step 1: Testes que falham:**
  - `periodo.test.ts`: padrão em 17/11/2026 = 2025-12..2026-11; "De" depois de "Até" → `erro: 'ordem'`, números do padrão e `escolhido` preservado; mesmo mês vale; 13 meses → `'longo'`; texto inválido → `'invalido'`; mês futuro recusado; virada do ano e do mês em `America/Sao_Paulo` com o relógio em UTC; `opcoesDeMes` com primeiro cadastro em 09/2026 começa em 12/2025 (RE-D48), com primeiro cadastro em 2023 começa em 2023.
  - `acesso.test.ts`: tabela exaustiva `Record<Secao, …>` por papel e permissão; a recepção nunca tem `ranking`, `atendimentos` nem `planos`.
  - `csv.test.ts`: separador `;`, BOM, CRLF, vírgula decimal, "−" no negativo, percentuais sem "%", célula começando com `=`, `+`, `-`, `@`, tab ou CR ganha `'` (mesma função do 20); nome do arquivo; Ranking com a coluna "Paciente (nome de registro)".
  - `registro.test.ts` (Testcontainers): agregado grava uma linha `exportar`, entidade `relatorios`, `patient_id` nulo, `entidade_id` `agenda|2026-01..2026-06|todos`; Ranking grava uma linha por paciente; nenhum `ler`.
- [ ] **Step 2:** `pnpm vitest run src/modules/relatorios src/modules/plataforma/audit.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm vitest run src/modules/financeiro/csv.test.ts`; `pnpm typecheck`.
- [ ] **Step 5:** commit `feat(relatorios): núcleo, período e CSV (P26-01)`.

**Pronto quando:** testes verdes; `periodo.ts` não edita nem reexporta `fuso.ts`; revisão do `revisor-interface` só dos textos.

---

### Task 2: Relatórios — as seis seções no SQL (PR 1)

**Files:**
- Create: `src/modules/relatorios/{pacientes,atendimentos,planos,agenda,financeiro,ranking}.ts`
- Modify: `src/modules/financeiro/resumo.ts` (no **fim**: `recebidoEPagoPorMes(tx, tenantId, periodo, localId?)`, `porCategoriaNoPeriodo(tx, tenantId, periodo)`, `receitaPorPaciente(tx, tenantId, periodo, { localId?, limite })` para o Ranking por receita; RN-491, RE-D68), `test/carga/{seed.ts,cenario.js}` (cenário "relatórios", só acrescentar; CS-483)
- Test: `src/modules/relatorios/secoes.test.ts` (cenário fixo), `src/modules/relatorios/consistencia.test.ts` (CS-482), `src/modules/financeiro/resumo.test.ts` (casos novos em `describe` próprio)

**Interfaces:**
```ts
export async function relatorioPacientes(ctx: TenantContext, tenant: TenantRel, p: Periodo, o: { localId: string | null; acesso: Acesso }, deps?): Promise<RelPacientes>;
// RelPacientes = { situacao: { ativos, arquivados, bloqueados?: number /* ausente na recepção, RE-D39 */, total }; sexo: Linha[]; fase: Linha[]; faixas: Linha[]; novosPorMes: { mes, n }[] }
export async function relatorioAtendimentos / relatorioPlanos / relatorioAgenda / relatorioFinanceiro(…): Promise<…>;
export async function relatorioRanking(ctx, tenant, p, o: { localId; por: 'consultas' | 'receita' }, deps?): Promise<{ patientId: string; nomeExibido: string; nomeRegistro: string; valor: number }[]>;
```
- Cada função: `podeVerSecao` antes de `withTenant`; uma transação; `count(*) filter (…)` e `date_trunc('month', … at time zone fuso)`; nenhuma coluna de conteúdo (planos: só `publicado_em`, `patient_id`, `status`; atendimentos: só `data`, `patient_id`, `appointment_id`). Agenda reaproveita a conta de `indicadoresDaAgendaNaTransacao` (`presenca.ts:71`) para "Taxa de faltas", e `textoTaxa`. Financeiro e o Ranking por receita só chamam as funções do módulo do 20 (nenhuma consulta a `fin_*` fora dele, RN-491, RE-D68). Ranking com `limit 20` no SQL e empate por `app_unaccent(lower(<nome exibido>))` (função da 0040 sobre a extensão `unaccent` da 0000; RE-D68).
- Retorno (RN-488, RN-490): na sessão `nutri`, lê `consultations` e `appointments`; a variante da recepção (RN-510) chega na T11b, pela função do PR 2.

- [ ] **Step 1: Testes que falham** (`secoes.test.ts`, um cenário de banco montado uma vez):
  - Pacientes: 40 ativos, 8 arquivados, 2 bloqueados, 1 anonimizado → "Total 50", anonimizado fora; fase da vida com 25, 45, 70 anos e sem data; "Menos de 18" por dado antigo; percentuais com uma casa e "—" com total 0; novos por mês contando o anonimizado.
  - Atendimentos: os três cenários da US-481 (consulta realizada + atendimento no mesmo dia = 1 paciente; Bruno sem consulta; primeira × retorno pelo `min`).
  - Planos: cada versão publicada conta; modelos (`patient_id` nulo) fora; cartão "hoje".
  - Agenda: colunas da US-483; `sistema` fora; `cancelado_por = 'paciente'` e `'nutri'`; "Marcadas pelo paciente" (`origem = 'paciente'`, não canceladas); "Retornos" pela RN-488 (paciente com consulta realizada ou atendimento antes do `inicio`; primeira consulta da vida não conta). O que depende do 23 (`solicitada` fora, `pedido_desistido` em "Canceladas pelo paciente", `pedido_recusado`/`pedido_vencido` fora, previsões) fica na T11a.
  - Financeiro: só não cancelados com `pago_em` no mês; por categoria; não configurado → estado vazio.
  - Ranking: 21 pacientes → 20; empate alfabético sem acento; bloqueado e anonimizado fora; nome exibido × de registro.
  - Nenhuma função grava `audit_log` (agregado sem `auditRead`).
  - `consistencia.test.ts`: mês atual "Marcadas"/"Faltas" = `indicadoresDaAgenda`; "Recebido"/"Pago" = Resumo do mês do 20.
- [ ] **Step 2:** `pnpm vitest run src/modules/relatorios src/modules/financeiro/resumo.test.ts` → FAIL.
- [ ] **Step 3:** implementar; `EXPLAIN` de cada consulta no cenário da carga (RN-496), anotado no PR; índice novo só se a CS-483 pedir (aí vai para a migration do PR 2).
- [ ] **Step 4:** mesmo comando → PASS; pilha de carga com o cenário "relatórios" (p95 ≤ 800 ms, app com 2 vCPU; a rodada na sessão da recepção, com o `EXISTS` por linha em `appointments` e `fin_lancamentos`, fica na T11b).
- [ ] **Step 5:** commit `feat(relatorios): seções agregadas (P26-02)`.

**Pronto quando:** testes e carga verdes; revisão do `revisor-rls` (nenhuma leitura de conteúdo, `exportar` certo, `ranking` sem `auditRead`).

---

### Task 3: Relatórios — telas, impressão, CSV, menu e guia (PR 1)

**Files:**
- Create: `src/app/painel/relatorios/{layout.tsx,page.tsx,abas.tsx,filtros.tsx,tabela.tsx,barras.tsx}`, `src/app/painel/relatorios/{atendimentos,planos,agenda,financeiro,ranking}/page.tsx`, `src/app/painel/relatorios/imprimir/page.tsx`, `src/app/api/painel/relatorios/csv/route.ts`, `e2e/relatorios.spec.ts`
- Modify: `src/app/painel/navegacao.ts` ("Relatórios" entre "Financeiro" e "Configurações"), `src/app/painel/navegacao.test.ts` (a lista nova), `src/modules/ajuda/conteudo.ts` (guia `relatorios` v1, `padrao` `/^\/painel\/relatorios(\/(atendimentos|planos|agenda|financeiro|ranking))?$/`, texto do `filtro-periodo` **sem** o local — a frase do local entra na v2, T11a; `SEM_AJUDA` + `/painel/relatorios/imprimir` "página de impressão, sem menu"; guia `boas-vindas` com versão + 1 sobre a da `main` se o passo do menu listar os itens, porque o menu muda já no PR 1), `src/modules/ajuda/conteudo.test.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade-painel.spec.ts`, `src/app/formularios-post.test.ts` (`filtros.tsx` em `GET_PERMITIDOS`), `next.config.ts` (`Cache-Control: no-store` para `/painel/relatorios/imprimir` e a rota do CSV; depois da regra `/:path*`)
- Test: `src/app/painel/relatorios/page.test.ts`, `src/app/api/painel/relatorios/csv/route.test.ts`

- Todas as páginas e a rota chamam **`requireNutri`/`requireApiNutri`** no PR 1 (RE-D51); `podeVerSecao` com `{ papel: 'nutri', financeiro: true }`. A T11b troca por `requireEquipe` e entra em `ROTAS_DA_RECEPCAO`.
- Abas: `nav aria-label="Seções dos relatórios"`, links com `aria-current="page"` levando `de`, `ate` e `local`. Ranking: "Mais consultas"/"Maior receita" como links com `aria-current`.
- Filtro inválido (RN-481): erro com `aria-invalid` + `aria-describedby` no `<select>`, "Mostrando …", foco no aviso por marcador na URL (o padrão `FocoNoTitulo` do Plano 18); nada de `role="alert"` no render do servidor.
- Tabelas com `caption` e `th scope`; a de 12 meses em `role="region"` focável com `focus-visible:outline-offset-[-3px]`; barras com `aria-hidden`, classes de token, `print:hidden`.
- Impressão: `<title>` "Relatório de {seção} — {consultório}", cabeçalho e rodapé da §6.2, "Imprimir ou salvar em PDF" (`window.print`, componente cliente mínimo) e "Voltar aos relatórios"; o link nos Relatórios é "Ver versão para imprimir", `prefetch={false}`; grava o `exportar` na transação da leitura.
- CSV: `text/csv; charset=utf-8`, `attachment`, `no-store`; período inválido → 303 para a seção com `?erro=periodo`; sem sessão → login com a volta; DPA pendente → `/painel/dpa`; seção não permitida numa navegação → 303 para `/painel/sem-permissao` (a página nasce na T6; até lá, 403 — o teste fixa o 403 e a T6 o troca).

- [ ] **Step 1: Testes que falham:**
  - `page.test.ts`: seis abas na ordem, `aria-current` na atual; filtros mantêm `de/ate/local` nos links; erro de período com `aria-invalid` e "Mostrando dezembro de 2025 a novembro de 2026."; estado vazio "Ainda não há dados neste período."; Financeiro não configurado com "Configurar o Financeiro"; aviso do Ranking.
  - `route.test.ts`: cabeçalhos, nome do arquivo, BOM; sessão expirada → redirect (nunca JSON); período inválido → 303; DPA pendente → `/painel/dpa`; um `exportar` por chamada (agregado) e um por paciente (Ranking); com erro forçado na leitura, o log capturado tem só o código, a seção e o motivo técnico — nenhum número, nome, valor, categoria ou local (RNF-482).
  - `imprimir/page.test.ts`: o render grava o `exportar` na transação da leitura (agregado: uma linha sem paciente; Ranking: uma por paciente) e nenhum `ler`.
  - `navegacao.test.ts`: os itens novos na ordem; `conteudo.test.ts`: `relatorios` cobre as seis rotas, imprimir em `SEM_AJUDA`; `rotas-axe.test.ts` com as sete rotas.
- [ ] **Step 2:** `pnpm vitest run src/app/painel/relatorios src/app/api/painel/relatorios src/app/painel/navegacao.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts src/app/formularios-post.test.ts` → FAIL.
- [ ] **Step 3:** implementar (ler `node_modules/next/dist/docs/` sobre `searchParams` como `Promise`, Route Handlers e `prefetch`).
- [ ] **Step 4:** mesmo comando → PASS; `e2e/relatorios.spec.ts` (filtro, troca de aba mantendo o filtro, CSV baixado e lido, impressão, Ranking com link para a ficha; IPs `10.9.36.1`–`.9`); axe das sete rotas em 1280 e 360 px, claro e escuro.
- [ ] **Step 5:** fechamento do PR 1: manual técnico cap. 05 (seção "Relatórios"), CLAUDE.md regra 8 (frase "Plano 26": agregado sem `auditRead`, `exportar` da entidade `relatorios`), commit `feat(relatorios): telas, CSV e impressão (P26-03)`.

**Pronto quando:** E2E e axe verdes; revisão do `revisor-interface` (abas, filtros, erro do período, tabelas no celular, impressão) e do `guardiao-manual` sem Critical/Important.

---

### Task 4: Banco da recepção (a) — papel, negação por padrão, `equipe_membros` e guardas (PR 2)

> **Divisão (RE-D54, RE-D66):** a custom `rls_recepcao` é uma só; a T4 escreve os blocos 1 e 2 da spec §9.3, a T5a o bloco 3 e a T5b os blocos 4 e 5, cada uma com o próprio ciclo TDD, commit e revisão do `revisor-rls`.

**Files:**
- Modify: `src/db/schema/auth.ts` (CHECK `user_app_role_valido` com `recepcao`, CHECK `user_recepcao_com_tenant`, `ultimoAcessoEm`), `src/db/schema/access.ts` (`invites_tipo_valido`, `invites_alvo` da §9.2), `src/db/schema/index.ts` (exporta `equipe.ts`)
- Create: `src/db/schema/equipe.ts` (`equipeMembros`, spec §9.1), `drizzle/<NNNN>_recepcao.sql` (gerada), `drizzle/<NNNN+1>_rls_recepcao.sql` (custom: blocos 1 e 2), `docs/operacao/recepcao.md` (runbook inicial)
- Modify: `src/db/migrate.ts` (`Pool` do migrador com `options: '-c lock_timeout=10s'`, RE-D64; teste em `migrate.test.ts`: `show lock_timeout` na conexão do migrador = `10s`), `src/db/tenant.ts` (`TenantRole` + `recepcao`; `assertContext`: ator obrigatório, `patientId` e `semConta` recusados), `src/db/rls-guard.ts` (`STAFF_ONLY` + `equipe_membros`; `RECEPCAO_LIBERADO` só com `equipe_membros: ['select']` nesta tarefa; `RECEPCAO_CONDICOES`; `findRecepcaoViolations`; `findStaleExceptions` cobrindo as listas novas), `src/db/rls-guard.test.ts`, `test/isolamento.test.ts` (sessão `recepcao` em todos os casos genéricos, RE-D55; `FABRICAS` + `equipe_membros` criando o `user` no mesmo comando, num CTE; `SEM_DELETE`, `DELETE_REVOGADO`, `IMUTAVEIS`), `CLAUDE.md` (regra 2, frase "Plano 26": negação por padrão, `app_allow_recepcao` + `RECEPCAO_LIBERADO`, condições `recepcao_cond_*` em `RECEPCAO_CONDICOES`)
- Test: `src/db/recepcao-banco.test.ts` (novo), `src/db/tenant.test.ts`, `src/db/migrate.test.ts`

**Custom, blocos 1 e 2** (spec §9.3): `app_deny_recepcao`, `app_allow_recepcao` (molde `app_allow_publico`, 0051), `app_enable_tenant_rls` com o **corpo da 0070** + `PERFORM app_deny_recepcao(tbl)`, laço com `schemaname = 'public'` (sem `SET LOCAL lock_timeout`: o limite vem da conexão do migrador, RE-D64, porque o migrador roda todas as pendentes numa transação, `drizzle-orm/pg-core/dialect.js:60`, e a migration gerada já trava `user` antes da custom); `equipe_membros` (RLS, `staff_only`, `app_allow_recepcao('equipe_membros','select')`, `recepcao_cond_propria_linha` FOR SELECT, `REVOKE DELETE, TRUNCATE`, gatilho `equipe_membros_regras` da §9.1, índice parcial).

- [ ] **Step 1: Testes que falham:**
  - `isolamento.test.ts`: para cada tabela de `FABRICAS`, a sessão `recepcao` lê 0 linhas e tem INSERT/UPDATE/DELETE recusados (vermelho em todas antes da custom); `equipe_membros`: a recepção lê só a própria linha e não grava; paciente, público e conta recusados pela política (`violaRlsDe`).
  - `recepcao-banco.test.ts`: `app_enable_tenant_rls` numa tabela de rascunho cria `tenant_isolation`, `publico_negado`, os quatro `paciente_sem_*` e `recepcao_negada` (I2); o laço não pega tabela fora de `public`; `equipe_membros_regras` (INSERT da `nutri` com `user` de outro tenant ou de papel `nutri` → 42501; `desativada_por` gravado; colunas fixas; `worker` e contexto vazio → 42501; recepção → 42501); CHECK `user_recepcao_com_tenant`; `invites_alvo` com `recepcao` sem `tenant_id` recusado.
  - `rls-guard.test.ts`: `findRecepcaoViolations()` vazio; controles positivos — tabela de rascunho sem `recepcao_negada` → violação; condição `recepcao_cond_x` PERMISSIVE → violação; nome `recepcao_sem_bloqueados` (fora dos três padrões) → violação.
  - `tenant` (`assertContext`): `recepcao` sem ator → erro; com `patientId` ou `semConta` → erro.
- [ ] **Step 2:** `pnpm vitest run test/isolamento.test.ts src/db/recepcao-banco.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/db/migrate.test.ts` → FAIL.
- [ ] **Step 3:** schema, `pnpm db:generate --name recepcao`, custom com os blocos 1 e 2, `DATABASE_URL_MIGRATOR` (regra 7); `migrate.ts` com o `lock_timeout`; runbook com "Volta atrás" (a imagem anterior recusa a recepção por `requireUser`/`requireNutri`; conferir as listas do admin — `contas.ts`, `metricas-sucesso.ts`, telas de `/admin` — com uma conta `recepcao` no banco de dev: nenhuma quebra nem a conta como nutricionista) e o comportamento do boot quando o `lock_timeout` estoura (conferir em `src/db/migrate.ts` e no `entrypoint`: o processo sai e o Swarm reinicia).
- [ ] **Step 4:** mesmo comando → PASS; `pnpm drizzle-kit check`.
- [ ] **Step 5:** commit `feat(banco): papel recepcao e negação por padrão (P26-04)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` sem Critical/Important (foco: corpo da 0070, laço, guarda, gatilho de `equipe_membros`).

---

### Task 5a: Banco da recepção (b) — liberações, condições, paciente visível e Financeiro (PR 2)

**Files:**
- Modify: `drizzle/<NNNN+1>_rls_recepcao.sql` (bloco 3 da §9.3: liberações da §4.3 — **sem** `public_booking_requests`, RE-D59; `app_recepcao_tem_financeiro()`; condições `recepcao_cond_paciente_visivel`, `recepcao_cond_financeiro` com `(SELECT app_recepcao_tem_financeiro())`, `recepcao_cond_notificacoes_da_agenda`; `CREATE OR REPLACE` de `fin_lancamentos_regras` com o ramo `recepcao` e o `NOT FOUND`)
- Modify: `src/db/rls-guard.ts` (`RECEPCAO_LIBERADO` completo; `RECEPCAO_CONDICOES` com os trechos exigidos), `src/modules/notificacoes/tipos.ts` (`TIPOS_DA_AGENDA` e `TIPOS_FORA_DA_RECEPCAO`, sem `convite_paciente`; tipo só de pedido de pessoa nova fora), `test/isolamento.test.ts` (as liberações: comandos liberados passam, os outros recusam)
- Test: `src/db/recepcao-banco.test.ts` (condições), `src/modules/notificacoes/tipos.test.ts` (lista × política × CHECK), `src/db/rls-guard.test.ts`, `src/modules/financeiro/banco.test.ts`

- **Fixture do isolamento (RE-D55):** a sessão `recepcao` dos casos genéricos usa um ator com linha em `equipe_membros` (`financeiro = true`, ativa, no tenant do teste) e a fábrica de `notifications` usa um tipo de `TIPOS_DA_AGENDA`; senão `app_recepcao_tem_financeiro()` dá falso e os negativos entre tenants de `fin_*` e `notifications` passariam pela condição, não pelo isolamento, e os positivos "comandos liberados passam" falhariam. Um caso à parte confere a recusa com `financeiro = false` e com tipo clínico.

- [ ] **Step 1: Testes que falham** (`recepcao-banco.test.ts`, sessão `recepcao` salvo dito):
  - **Paciente escondido (RE-D40):** com o paciente bloqueado e outro anonimizado, INSERT em `appointments`, `notifications`, `patient_cadastro` e `fin_lancamentos` com o id dele → recusado; UPDATE de consulta dele → 0 linhas; SELECT → 0 linhas; `fin_lancamentos_regras` com paciente não achado → 42501; nutricionista no mesmo cenário continua como hoje (RN-315 do 20).
  - **Notificações:** a recepção não lê nem grava `plano_novo`, `documento_novo`, `exame_revisado` etc.; grava `consulta_marcada`.
  - **Financeiro:** sem a permissão, 0 linhas em `fin_*` e INSERT recusado; com a permissão, lança e recebe; desativada, 0 linhas; `criado_por` = a recepção; `EXPLAIN` de uma leitura de `fin_lancamentos` mostra a função como `InitPlan` (uma avaliação), não por linha.
  - **`public_booking_requests`:** a recepção lê 0 linhas e não grava (RE-D59; `recepcao_negada`).
  - `tipos.test.ts`: `TIPOS_DA_AGENDA` = a lista da política (lida de `pg_policies`) e ⊂ CHECK de `notifications.tipo`; todo tipo do CHECK tem decisão (na lista ou em `TIPOS_FORA_DA_RECEPCAO`) — tipo novo de outro plano sem decisão falha.
  - `rls-guard.test.ts`: `findRecepcaoViolations()` vazio com a matriz completa; `RECEPCAO_CONDICOES` confere os trechos (inclusive o `SELECT` em volta da função).
- [ ] **Step 2:** `pnpm vitest run src/db/recepcao-banco.test.ts test/isolamento.test.ts src/db/rls-guard.test.ts src/modules/notificacoes/tipos.test.ts src/modules/financeiro/banco.test.ts` → FAIL.
- [ ] **Step 3:** implementar (corpos copiados da `main` do momento: `fin_lancamentos_regras` e o CHECK de `notifications.tipo`).
- [ ] **Step 4:** mesmo comando → PASS; `pnpm vitest run src/modules/financeiro` (nada da nutricionista mudou).
- [ ] **Step 5:** commit `feat(banco): liberações e condições da recepção (P26-05a)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` sem Critical/Important (matriz, condições, `NOT FOUND`, fixture do isolamento).

---

### Task 5b: Banco da recepção (c) — gatilhos de colunas, pedidos do 23, funções `SECURITY DEFINER` e `FUNCOES_COM_PAPEL` (PR 2)

**Files:**
- Modify: `drizzle/<NNNN+1>_rls_recepcao.sql` (blocos 4 e 5 da §9.3: gatilhos `patients_da_recepcao`, `patient_cadastro_da_recepcao`, `appointments_da_recepcao`, `tenants_so_nutri`; `CREATE OR REPLACE` de `app_appointments_regras_pedido` com o corpo da `main` do momento e o papel `recepcao` no aceite e na recusa, RE-D59; `app_retorno_das_consultas`, `app_consulta_tem_atendimento` (RE-D62) e `app_previsoes_de_retorno`, molde 0083)
- Modify: `src/db/rls-guard.ts` (`FUNCOES_COM_PAPEL` com a tabela da §4.4 **e** a lista do Step 0; `findPapelEmFuncoesViolations` com o regex da RN-511 e os gatilhos das tabelas liberadas que leem `patients`), `src/db/migrate-owner.test.ts` (`describe` novo no fim, RE-D56), `CLAUDE.md` (regra 2, frase "Plano 26")
- Test: `src/db/recepcao-banco.test.ts` (gatilhos), `src/db/rls-guard.test.ts`, `src/db/migrate-owner.test.ts`

- [ ] **Step 0 (PM-R1, PM-R13):** no banco de teste da `main` do momento (Testcontainers ou `nutri_dev_x` recriado), listar por `pg_proc` toda função do schema `public` que cita `'nutri'`, `app_current_role` ou `current_setting('app.role'`, e os gatilhos das tabelas de `RECEPCAO_LIBERADO` que leem `patients`; decidir cada função nova dos Planos 19, 21, 22, 23 e 25 (tabela negada → "não se aplica"; ex.: as do 22 com `IF r <> 'nutri' THEN RETURN NEW`; do 23, `app_appointments_regras_pedido` "como nutri, refeita", `app_tenants_agenda_da_equipe`, `app_pedido_aguardar` "não se aplica"). Pedir à orquestradora o aviso às sessões do 21, 22, 23 e 25 (o que fica negado, `TIPOS_FORA_DA_RECEPCAO`, `FUNCOES_COM_PAPEL`; ao 23, que o aceite e a recusa de pedido passam a aceitar a recepção).
- [ ] **Step 1: Testes que falham** (`recepcao-banco.test.ts`, sessão `recepcao` salvo dito):
  - **`patients_da_recepcao`:** INSERT com `user_id` de uma conta de paciente existente → 42501; com `status = 'arquivado'`, `origem = 'agendamento_publico'`, `bloqueado_em`, `anonimizar_apos`, `ia_recusada_em`, `peso_oculto_no_app_em`, `whatsapp_optin_em` → 42501; INSERT só com os campos permitidos → ok; UPDATE de `email` → 42501; UPDATE de `nome`/`telefone_e164` → ok; UPDATE que mantém as colunas de WhatsApp como estão → ok.
  - **`patient_cadastro_da_recepcao`:** INSERT com `observacao` ou `identidade_genero` → 42501; UPDATE que muda uma delas → 42501; UPDATE do endereço → ok.
  - **`appointments_da_recepcao`:** INSERT `realizada`, `faltou`, `origem='paciente'`, `cancelado_por='sistema'`, `presenca_em` preenchido → 42501; UPDATE de `patient_id`, `origem`, `remarcada_de`, `motivo_cancelamento` → 42501; `cancelado_por='paciente'` → 42501; `cancelado_por='pedido_recusado'` saindo de `agendada` → 42501; `→ realizada` e `realizada →` → 42501; `→ faltou` antes do início → 42501, depois do início a partir de `agendada` → ok; **depois do início com uma linha de `consultations` ligada (consulta ainda `agendada`) → 42501** (RE-D62).
  - **Pedidos do 23 (RE-D59):** consulta `solicitada` de paciente cadastrado: a recepção aceita (`→ agendada`) e recusa (`cancelada`, `pedido_recusado`) → ok, com o ator dela no `audit_log`; `('recepcao','sistema')`, `('recepcao','pedido_vencido')` e mudar horário, local, modalidade ou paciente do pedido → 42501; nutri, paciente e worker continuam como na `main` (os testes do 23 passam sem mudança).
  - **`tenants_so_nutri`:** UPDATE de `tenants` na sessão `recepcao` → 42501; nutri e worker passam.
  - `migrate-owner.test.ts` (dono `NOBYPASSRLS`): `app_retorno_das_consultas` devolve só `(appointment_id, retorno)`, só de consultas de pacientes visíveis do tenant, recusa período > 13 meses, devolve vazio para `paciente`, `publico` e `worker`, restaura `app.role`/`app.patient_id`; `app_previsoes_de_retorno` idem com `(patient_id, previsto_em)`; `app_consulta_tem_atendimento` devolve `true`/`false` só para consulta do tenant com paciente visível, `false` (ou nulo) para outro tenant e para outro papel, e restaura o contexto.
  - `rls-guard.test.ts`: `findPapelEmFuncoesViolations()` vazio; controle positivo com função de rascunho que cita `current_setting('app.role'`.
- [ ] **Step 2:** `pnpm vitest run src/db/recepcao-banco.test.ts test/isolamento.test.ts src/db/rls-guard.test.ts src/db/migrate-owner.test.ts` → FAIL.
- [ ] **Step 3:** implementar (corpo de `app_appointments_regras_pedido` copiado da `main` do momento; só os dois pontos do papel mudam).
- [ ] **Step 4:** mesmo comando → PASS; `pnpm vitest run src/modules/agenda src/modules/pacientes` (nada da nutricionista mudou).
- [ ] **Step 5:** CLAUDE.md regra 2 (frase "Plano 26": `FUNCOES_COM_PAPEL`; funções da RN-510 no molde 0083, inclusive `app_consulta_tem_atendimento`; guarda de módulo sobre tabela negada → função booleana); commit `feat(banco): gatilhos e funções da recepção (P26-05b)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` sem Critical/Important (listas brancas, `app_appointments_regras_pedido`, peças `SECURITY DEFINER`, decisões do Step 0).

---

### Task 6: Sessão, entrada, rotas e páginas de aviso (PR 2)

**Files:**
- Modify: `src/lib/session-rules.ts` (`AppRole` + `recepcao`, `ROTULO_PAPEL`, `homeFor`, `setup-2fa` para recepção sem 2FA, `ehPapel`), `src/lib/tenant-session.ts` (`requireEquipe(path, { secao?, financeiro?, permitirDpaPendente? })` e `requireApiEquipe`: aceitam `nutri` e `recepcao` ativa; lê a linha de `equipe_membros` na mesma `cache()` da sessão; desativada → `/conta/acesso-desativado`; DPA pendente → `/painel/contrato-pendente`; sem a permissão → `/painel/sem-permissao?motivo=financeiro`; `requireNutri` com a recepção → `?motivo=nutri`), `src/lib/auth.ts` (`session.create.after`: `ultimo_acesso_em` da conta `recepcao`), `src/app/conta/seguranca/page.tsx` (aceita `recepcao`; aviso do 2FA obrigatório como o do admin; tema como o da nutricionista; recepção desativada → `/conta/acesso-desativado`), `src/app/inicio/page.tsx` (aceita `recepcao` → `homeFor` = `/painel`; é o destino do login, `entrar/page.tsx:44`, do 2FA, `entrar/2fa/page.tsx:29`, e do "Continuar" da Segurança, `enable-2fa.tsx:67`), `src/app/conta/outro-papel/page.tsx` (`requireUser` com `recepcao`; `VOLTAR` e `textoOutroPapel` com o papel; tema como o da nutricionista), `src/app/api/sessao/ativa/route.ts` (`EQUIPE` com `recepcao`: aviso de inatividade e renovação pelo uso, RN-501; RE-D67), `src/app/painel/preferencias/actions.ts` (`alternarTemaAction` e `marcarGuiaAction` com `requireEquipe`; contrato do comentário cita a recepção), `src/app/painel/cabecalho.test.ts` (aceita `requireEquipe` só em `ROTAS_DA_RECEPCAO`), `scripts/e2e-seed.ts` (`E2E_RECEPCAO` e `E2E_RECEPCAO_FIN` criadas **uma vez** — `onConflictDoNothing`/busca por e-mail, nunca `delete user` —, com 2FA de teste como `E2E_DOCS`, linha de `equipe_membros` gravada por `withTenant({ role: 'nutri', actorUserId: <E2E_NUTRI> })` — o gatilho recusa `worker` e contexto vazio, e a semente hoje usa `worker` (`e2e-seed.ts:109,202`); RE-D69 — e aceite do termo; `guia` zerado por UPDATE em `E2E_RECEPCAO_FIN` a cada execução, para o tour; RE-D46), `src/app/api/painel/relatorios/csv/route.ts` (403 → 303 para "Sem permissão")
- Create: `src/app/painel/rotas-da-recepcao.ts` (`ROTAS_DA_RECEPCAO` do PR 2: `/painel`, `/painel/sem-permissao`, `/painel/contrato-pendente`, `/painel/ajuda`, as duas actions de preferências; e, num bloco separado `FORA_DO_PAINEL`, `/conta/seguranca`, `/conta/acesso-desativado`, `/inicio`, `/conta/outro-papel`, `/api/sessao/ativa` — esse bloco **não** entra na regra "toda entrada chama `requireEquipe`"), `src/app/painel/rotas-da-recepcao.test.ts` (teste de fonte da RN-513, por action exportada de **todo** arquivo com `'use server'` em `src/app/painel`, não só `actions.ts` — ex.: `consultas/[id]/cobranca-actions.ts`), `src/app/papeis-fora-do-painel.test.ts` (RE-D67: todo `requireUser(`/`requireApiUser(`/`lerSessaoApi(` de `src/app` fora de `src/app/painel` e `src/app/api/painel` está numa tabela com a decisão para `recepcao` — aceita ou recusa —; arquivo novo sem decisão falha; controle positivo com rascunho), `src/app/painel/sem-permissao/page.tsx`, `src/app/painel/contrato-pendente/page.tsx`, `src/app/conta/acesso-desativado/page.tsx`
- Modify: `src/modules/ajuda/conteudo.ts` (`SEM_AJUDA` + `/painel/sem-permissao` e `/painel/contrato-pendente`, "tela de aviso, sem tarefa"; guia `seguranca` com a frase da recepção), `e2e/painel-rotas.ts`
- Test: `src/lib/session-rules.test.ts`, `src/lib/tenant-session.test.ts`, `src/lib/auth.test.ts`, `src/app/painel/sem-permissao/page.test.ts`, `src/app/conta/seguranca/page.test.ts` (ou o teste que já cobre a página), `src/modules/ajuda/conteudo.test.ts`

- [ ] **Step 1: Testes que falham:**
  - `session-rules.test.ts`: `Record<AppRole, …>` exaustivo; recepção sem 2FA → `setup-2fa`; prazos de 30 min e 8 h valem; rótulo "recepção".
  - `tenant-session.test.ts`: `requireNutri` com recepção → redirect `?motivo=nutri`; `requireEquipe` com recepção desativada → `/conta/acesso-desativado`; com DPA pendente → `/painel/contrato-pendente` (nutri continua indo a `/painel/dpa`); `{ financeiro: true }` sem a permissão → `?motivo=financeiro`; a linha de `equipe_membros` é lida uma vez por requisição; `requireApiEquipe` → 403.
  - `rotas-da-recepcao.test.ts`: toda `page.tsx`/`route.ts` de `src/app/painel` e `src/app/api/painel`, e toda action exportada de `actions.ts`, chama `requireNutri`/`requireApiNutri`, ou chama `requireEquipe`/`requireApiEquipe` **e** está na lista; toda entrada da lista chama `requireEquipe`; controle positivo com um arquivo de rascunho.
  - `auth.test.ts`: login da recepção grava `ultimo_acesso_em`; o da nutricionista não muda nada.
  - Páginas: "Sem permissão" com os dois textos; Segurança aceita a recepção e mostra o aviso do 2FA obrigatório; Segurança da recepção desativada → `/conta/acesso-desativado`.
  - Entrada (RE-D67): `/inicio` com a recepção → redirect para `/painel`; `/conta/outro-papel?esperado=paciente` com a recepção mostra o texto e "Ir para o painel"; `GET /api/sessao/ativa` com a recepção → 200 com os prazos; `POST` renova como para a nutricionista; `papeis-fora-do-painel.test.ts` verde.
  - Reinício do 2FA (§3): `reiniciarPeloAdmin` numa conta `recepcao` grava `admin_actions.alvo_papel = 'recepcao'` e a próxima entrada dela cai em `setup-2fa`.
- [ ] **Step 2:** `pnpm vitest run src/lib/session-rules.test.ts src/lib/tenant-session.test.ts src/lib/auth.test.ts src/app/painel/rotas-da-recepcao.test.ts src/app/papeis-fora-do-painel.test.ts src/app/painel/cabecalho.test.ts src/app/painel/sem-permissao src/app/conta src/app/inicio src/app/api/sessao src/modules/plataforma/reiniciar-2fa.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `e2e/recepcao.spec.ts` (primeiro bloco): `E2E_RECEPCAO` entra pelo login e pelo 2FA e **chega ao Início dela** (passando por `/inicio`, sem laço nem `/conta/outro-papel`), e `/painel/pacientes/{id}/antropometria` leva a "Sem permissão" sem gravar `audit_log`; `e2e/sessao-equipe.spec.ts` com a recepção (prazos e o aviso de 2 minutos antes de expirar, com o "Continuar na sessão" renovando).
- [ ] **Step 5:** commit `feat(sessao): papel recepcao na entrada e nas rotas (P26-06)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (rotas, sessão) e do `revisor-interface` (páginas de aviso, Segurança) sem Critical/Important.

---

### Task 7: Equipe, convite e termo de confidencialidade (PR 2)

**Files:**
- Create: `src/modules/plataforma/equipe.ts` (`listarEquipe`, `convidarRecepcao`, `reenviarConviteRecepcao`, `definirPermissaoFinanceiro`, `desativarRecepcao`, `reativarRecepcao`, `membroAtivo`; RN-499, RN-502, RN-503), `src/modules/plataforma/equipe-textos.ts` (`MSG_EQUIPE`, `MSG_RECEPCAO`, `EQUIPE_LIGADA = false`, RE-D52), `src/app/painel/configuracoes/equipe/{page.tsx,actions.ts,convidar-form.tsx,linha.tsx}`, `src/app/termos/sigilo-equipe/page.tsx` (pública; conferir `src/proxy.ts`: `/termos` fora de `PROTECTED`)
- Modify: `src/modules/plataforma/convites.ts` (tipo `recepcao`: `aceitarConvite` grava o aceite `sigilo-equipe-1.0` em vez do DPA), `src/modules/plataforma/textos-versionados.ts` (termo 1.0 com o conteúdo mínimo da PM-R3), `src/app/convite/[token]/{page.tsx,form.tsx,actions.ts}` (o tipo decide o formulário; `TextoLegalView` inline; caixa obrigatória; `text-erro` no lugar de `text-red-700`), `src/email/{types.ts,templates.tsx}` (`convite_recepcao`, no fim), `src/app/painel/configuracoes/page.tsx` (cartão "Equipe" no **fim** de `CARTOES`, só com `EQUIPE_LIGADA`), `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO.equipe`), `src/modules/ajuda/conteudo.ts` (guia `equipe` v1 com `padrao` `/^\/painel\/configuracoes\/equipe$/`, **antes** do `configuracoes`), `e2e/painel-rotas.ts`, `e2e/acessibilidade.spec.ts` (`/termos/sigilo-equipe`), `CLAUDE.md` (regra 1: `equipe.ts` e `src/lib/auth.ts` na lista da tabela `user`; `invites` e `consents` com o tipo `recepcao` e o termo `sigilo-equipe-<versão>`)
- Test: `src/modules/plataforma/equipe.test.ts`, `src/modules/plataforma/convites.test.ts` (casos novos), `src/modules/plataforma/textos-legais.test.ts`, `src/app/painel/configuracoes/equipe/page.test.ts`, `src/email/render.test.ts`

- A rota `/painel/configuracoes/equipe` chama `requireNutri` e, com `EQUIPE_LIGADA = false`, responde `notFound()`; **as actions da Equipe** (convidar, reenviar, permissão, desativar, reativar) também recusam com a constante desligada (o `notFound()` da página não fecha um POST direto); o módulo e os testes funcionam com a constante desligada (o teste injeta).
- `ROTAS_DO_PAINEL` ganha a rota na T7 (a guarda `rotas-axe.test.ts` exige uma entrada por `page.tsx`); no PR 2 o axe dela vê o `notFound()` (sem violação esperada) e o axe de verdade da Equipe é o da T11b, com a constante ligada — registrar no PR 2.
- Confirmações por `?ok=` com marcador e foco (§7.2); `<details>` aberto no erro; erros por `aria-describedby`; tabela em região focável; `aria-label` "Desativar {nome}" etc.; textos neutros.

- [ ] **Step 1: Testes que falham:**
  - `equipe.test.ts`: convite cria `user` (`recepcao`, `tenant_id`), linha, convite de 72 h e e-mail na mesma transação; nome com 2 e com 81 caracteres → "Informe o nome (3 a 80 caracteres)", com 3 e 80 → ok; quarto convite com 3 ativas → mensagem; dois convites concorrentes com 2 ativas → um só passa (trava do tenant); e-mail existente (paciente, nutri, outro consultório) → a mesma mensagem neutra; consultório suspenso → recusado; reenviar só sem senha; permissão grava e audita `alterar` da entidade `equipe`; desativar apaga sessões e convite pendente na mesma transação, grava `desativada_por`; reativar acima do limite → mensagem; nada de nome ou e-mail no log (captura do logger).
  - `convites.test.ts`: aceite `recepcao` sem a caixa → mensagem; com a caixa → `consents` com `sigilo-equipe-1.0`, tenant e IP, e **sem** DPA; o convite de nutricionista continua como hoje.
  - `textos-legais.test.ts`: o termo 1.0 tem os oito itens da PM-R3 e a versão; `page.test.ts`: limite some o botão; situação "Convite enviado (vale até {dd/mm/aaaa} às {hh:mm})", "Convite vencido", "Ativo" e "Acesso desativado em …"; "Último acesso" ou "Ainda não entrou".
  - `actions.test.ts` (Equipe): com `EQUIPE_LIGADA = false`, cada action recusa e nada é gravado.
- [ ] **Step 2:** `pnpm vitest run src/modules/plataforma src/app/painel/configuracoes src/email/render.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar; termo 1.0 enviado à orquestradora como texto legal novo (C-486, um por vez).
- [ ] **Step 4:** mesmo comando → PASS; E2E do primeiro acesso num **consultório novo por execução** (molde `E2E_FIN_NOVO`, RE-D69: com o e-mail fixo a 2ª execução cairia em "e-mail já tem conta", porque `equipe_membros.user_id` é `NO ACTION` com DELETE revogado, e o consultório principal já tem `E2E_RECEPCAO` e `E2E_RECEPCAO_FIN`), com o convite criado pelo módulo no seed de teste e e-mail novo por execução (abrir o link do Mailpit, criar senha, aceitar o termo, configurar o 2FA, chegar ao Início dela); axe de `/convite/[token]` (recepção) e `/termos/sigilo-equipe`.
- [ ] **Step 5:** commit `feat(equipe): convite da recepção e termo de confidencialidade (P26-07)`.

**Pronto quando:** testes verdes; revisão do `normas-cfn-lgpd` (termo 1.0, conteúdo mínimo, §10) e do `revisor-interface` (Equipe, convite) sem Critical/Important; `revisor-rls` (`equipe.ts` × regra 1).

---

### Task 8: Painel da recepção — layout, menu, Início e manual guiado por papel (PR 2)

**Files:**
- Modify: `src/app/painel/layout.tsx` (`requireEquipe`; com a recepção, sem `contarEnviosRecebidos` nem `contadorDeDuvidas`; `GuiaDoPainel` com o papel), `src/app/painel/page.tsx` (ramo da recepção → `InicioDaRecepcao`, h1 "Seu dia, {nome}"), `src/app/painel/navegacao.ts` (`itensDoMenu(papel, financeiro)`; `itemAtual` marca "Pacientes" em `/painel/cadastro/{id}`), `src/app/painel/navegacao.test.ts` ("seis itens" vira a lista por papel), `src/app/painel/menu-conta.tsx` (recepção: "Rever o tour" do dela, "Manual", "Segurança", "Sair"; rótulo "{nome} · Recepção"), `src/modules/ajuda/conteudo.ts` (`Guia.papeis`, `guiaDaRota(caminho, papel)`; guia `recepcao-inicio` v1, `padrao` `/^\/painel$/`, alvos que existem no Início dela), `src/app/painel/guia/*`, `src/app/painel/ajuda/page.tsx` (filtra por papel), `src/app/painel/rotas-da-recepcao.ts`
- Create: `src/modules/agenda/inicio-recepcao.ts` (`inicioDaRecepcao`: `resumoDoDia`, presença a registrar, `novidadesDaAgenda`; com o 23, solicitações), `src/app/painel/inicio-recepcao.tsx`
- Test: `src/app/painel/navegacao.test.ts`, `src/modules/ajuda/conteudo.test.ts` (todo chamador de `guiaDaRota` passa o papel; `boas-vindas` só `nutri`; os guias da recepção não citam "Configurações", "Realizada", "Iniciar atendimento", "Ver bloqueados", Etiqueta nem Arquivar), `src/modules/agenda/inicio-recepcao.test.ts` (as chaves: sem indicadores de faltas, armazenamento, WhatsApp, IA, exames ou dúvidas), `src/app/painel/layout.test.ts` (ou o teste do layout que existir)

- No PR 2, os links do Início da recepção para a agenda ainda levam a "Sem permissão" — e é por isso que a Equipe nasce desligada (RE-D52).
- O Início dela não mostra indicadores do mês (RE-D63): a taxa de faltas fica em Relatórios › Agenda.
- Espião de leituras negadas (R-482, RNF-484 e): `src/app/painel/leituras-negadas.ts` exporta `LEITURAS_NEGADAS` (módulos que leem tabela negada à recepção: etiquetas, conexão do WhatsApp, prontuário, contadores clínicos, cobrança, `consultaParaIniciarAtendimento`, `motivoDoCancelamentoDaNutri`) e um helper de teste que, na sessão `recepcao`, falha se a página chamar algum deles ou `auditRead` fora da entidade do cadastro; o layout e o Início da recepção são os primeiros a usar (T9 a T11b usam em cada página da lista).

- [ ] **Step 1: Testes que falham:** menu da recepção sem a permissão = Início, Pacientes, Agenda, Relatórios; com a permissão + Financeiro; o da nutricionista com "Relatórios" e a lista de hoje; `guiaDaRota('/painel', 'recepcao')` = `recepcao-inicio`; `/painel/ajuda` da recepção sem os guias clínicos; layout da recepção não chama os contadores clínicos (espião); Início da recepção sem chaves clínicas.
- [ ] **Step 2:** `pnpm vitest run src/app/painel src/modules/ajuda src/modules/agenda/inicio-recepcao.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; E2E: `E2E_RECEPCAO_FIN` vê o tour `recepcao-inicio` no primeiro acesso (nunca o `boas-vindas`) e o tema muda pelo cabeçalho; axe do Início da recepção com a conta dela (laço próprio em `acessibilidade-painel.spec.ts`, 1280 e 360 px, claro e escuro), de "Sem permissão" e "Contrato pendente".
- [ ] **Step 5:** fechamento do PR 2: manual técnico cap. 02 (RLS da recepção, as quatro listas, as funções `SECURITY DEFINER` e o `lock_timeout` do migrador), cap. 03 (§3.2 Papéis, §3.5 2FA obrigatório da recepção, §3.6 Sessão e `/api/sessao/ativa`, §3.7 Guardas por papel — `requireEquipe`, `ROTAS_DA_RECEPCAO`, `FORA_DO_PAINEL` —, §3.10 Convites com o tipo `recepcao`, §3.12 Aceites com `sigilo-equipe-1.0`, §3.16 Fluxo de login com `/inicio`), cap. 04 (§4.1.1 Equipe junto das contas e convites; §4.1.6 manual guiado por papel), cap. 07 (guardas novas, sessão `recepcao` no isolamento, contas do E2E e consultório novo por execução), runbook; commit `feat(painel): Início, menu e guia da recepção (P26-08)`.

**Pronto quando:** testes e E2E verdes; revisão do `revisor-interface` (menu, Início, tour) e do `guardiao-manual` sem Critical/Important.

---

### Task 9: Pacientes e cadastro pela recepção (PR 3)

**Files:**
- Create: `src/app/painel/cadastro/[id]/{page.tsx,consultas/page.tsx,cabecalho.tsx}` (RN-515), `src/modules/pacientes/recepcao.test.ts`
- Modify: `src/modules/pacientes/pacientes.ts` (na sessão da recepção: `criarPaciente` sem convite nem WhatsApp; `atualizarPaciente` recusa e-mail diferente com `MSG_RECEPCAO.emailSoNutri` e não chama `autorizacaoWhatsapp`; `listarPacientes` ignora `etiqueta` e `situacao=bloqueados`; paciente não achado = "não encontrado"; `.returning()` com as colunas da projeção dela, nunca a linha inteira; duplicidade de e-mail e de CPF com a mesma mensagem para paciente visível e escondido, `CpfRepetidoError` sempre sem id na sessão dela, RE-D65), `src/modules/pacientes/cadastro.ts` (ou onde mora `cadastroDoPaciente`: projeção da recepção sem `observacao` e `identidade_genero`, `auditRead` "Cadastro do paciente"), `src/app/painel/pacientes/[id]/perfil/*` e `src/app/painel/pacientes/paciente-form.tsx` (os dois formulários ganham a variante da recepção, sem mudar as páginas da nutricionista: no Perfil e no **Novo**, sem identidade de gênero, observação, autorização do WhatsApp e "Convite também por WhatsApp" — `paciente-form.tsx:126,150-162`; sem a variante, o gatilho da lista branca recusaria o "Novo" com 42501), `src/app/painel/pacientes/page.tsx` e `novo/page.tsx` (`requireEquipe`; menu da linha "Abrir cadastro"/"Marcar consulta"; o nome leva a `/painel/cadastro/{id}` para a recepção; na sessão dela, `pacientes/page.tsx` não chama `listarEtiquetas` e `novo/page.tsx` não chama `situacaoDoWhatsapp`), a ficha "No app" da nutricionista (confirmação "O convite vai para {e-mail}. Confira o e-mail antes de enviar." no "Enviar convite"; conferir que `sem_convite` oferece o botão — `reenviarConvitePaciente` já serve), **os outros envios de link da nutricionista** (RE-D60: a tela de assinatura do documento, quando o paciente ativo não tem conta e a entrega vai por link — `entregarDocumento`, `entrega.ts:30-46`, chamado em `registrar-assinatura.ts:98`, e o código de abertura de `link-documento.ts:195` vão a `patients.email` —, "Reenviar link por e-mail" e "Enviar pedido de autorização por e-mail" da IA, `ia/autorizacao.ts:251`: "O link vai para {e-mail}. Confira o e-mail antes de enviar." antes de confirmar; só as telas mudam, os módulos não), `src/app/painel/rotas-da-recepcao.ts`, `src/modules/ajuda/conteudo.ts` (guias `recepcao-pacientes` e `recepcao-cadastro`, `papeis: ['recepcao']`; o `padrao` do `recepcao-cadastro` cobre `/painel/cadastro/[id]` **e** `/painel/cadastro/[id]/consultas`), `e2e/painel-rotas.ts`
- Test: `src/modules/pacientes/recepcao.test.ts`, `src/app/painel/cadastro/[id]/page.test.ts`, `src/app/painel/pacientes/page.test.ts` (casos da recepção), guarda de fonte "nenhum `select()` nem `.returning()` sem colunas de `patients`, `patient_cadastro`, `appointments`, `notifications` ou `fin_lancamentos` nos caminhos da recepção" (em `recepcao.test.ts`), testes das telas de envio de link da nutricionista (documentos e IA)

- [ ] **Step 1: Testes que falham:**
  - `recepcao.test.ts`: criar pela recepção → nenhum `invites` nem `notifications`, `audit_log` "criar" com o ator dela; atualizar com e-mail novo → mensagem, nada gravado; paciente com opt-in de origem `nutri` salva sem 42501 e o opt-in fica; bloqueado → "não encontrado"; `cadastroDoPaciente` da recepção: chaves sem `observacao`, `identidade_genero`, `peso_oculto_no_app_em`, `ia_*`, e uma linha `ler` "Cadastro do paciente"; lista da recepção sem bloqueados e sem filtro de etiqueta; **chaves de `listarPacientes`** na sessão dela (RNF-484 h) e do retorno de `criarPaciente`/`atualizarPaciente` sem `observacao`, `identidade_genero`, `peso_oculto_no_app_em` nem `ia_*`; e-mail ou CPF de paciente bloqueado → a mesma mensagem de um visível, sem id nem link (RE-D65).
  - Páginas da lista, do Novo e do cadastro na sessão da recepção com o espião de `LEITURAS_NEGADAS` (sem `listarEtiquetas`, `situacaoDoWhatsapp`, `auditRead` só "Cadastro do paciente"); "Novo" da recepção sem identidade de gênero, observação, autorização do WhatsApp e convite por WhatsApp, e salvando sem 42501.
  - `page.test.ts`: cabeçalho com nome exibido e "Nome de registro", sem medidas; a nutricionista é redirecionada para `/painel/pacientes/[id]/perfil`; e-mail só para leitura; "A nutricionista envia o convite do app."; nada de Arquivar, Etiquetas, peso no app, IA, WhatsApp, observação, identidade de gênero.
  - Ficha da nutricionista: "Enviar convite" com a confirmação do e-mail; a assinatura com entrega por link, "Reenviar link por e-mail" e "Enviar pedido de autorização por e-mail" mostram "O link vai para {e-mail}. Confira o e-mail antes de enviar." (RE-D60); paciente com conta (entrega pelo portal) não mostra.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes src/app/painel/cadastro src/app/painel/pacientes src/modules/documentos src/modules/ia src/app/painel/rotas-da-recepcao.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; E2E: a recepção cadastra um paciente, abre o cadastro, edita o telefone; a nutricionista vê no Histórico "Criou/Visualizou/Alterou — Cadastro do paciente — {nome} (recepção)" (US-495) e envia o convite com a confirmação; axe do cadastro da recepção e do "Novo paciente" com a conta dela.
- [ ] **Step 5:** commit `feat(pacientes): cadastro pela recepção (P26-09)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (projeções, e-mail, falha fechada, envios de link), do `normas-cfn-lgpd` (observação e identidade fora, P-R1, confirmação do e-mail) e do `revisor-interface` sem Critical/Important.

---

### Task 10: Agenda pela recepção (PR 3)

**Files:**
- Create: `src/modules/agenda/papel.ts` (`exigirEquipe(ctx)`, `FUNCOES_DA_RECEPCAO` para o teste de fonte), `src/modules/agenda/recepcao.test.ts`
- Modify: `src/modules/agenda/{consultas,presenca,disponibilidade,cancelamento}.ts` e, do 23, `visoes.ts`, `solicitacoes.ts`, `impressao.ts` (só as funções da RN-509 trocam `ctx.role === 'nutri'` por `exigirEquipe`; `lerBloqueios` sem `motivo` para a recepção; `registrarPresenca` recusa "realizada" para ela antes da transação e, para "faltou", confere o atendimento ligado por `app_consulta_tem_atendimento` (RE-D62; a busca em `consultations` volta vazia na sessão dela); `travarPacienteDaConsulta` com falha fechada; selo de retorno e previsão pela RN-510 na sessão da recepção; `solicitacoes.ts`: a fila da recepção só com pedidos de paciente cadastrado (consultas `solicitada`), aceitar e recusar por `exigirEquipe`, `aceitarPedidoPublico` e tudo de `public_booking_requests` continuam só `nutri` (RE-D59)), `src/app/painel/agenda/**` (páginas e actions da lista da RN-513 com `requireEquipe`; em `consultas/[id]/page.tsx`: "Abrir cadastro", sem `consultaParaIniciarAtendimento`, sem `motivoDoCancelamentoDaNutri`, sem `cobrancaDaConsulta` e sem a seção "Cobrança" com ou sem a permissão — `cobranca-actions.ts` continua `requireNutri` (RE-D61) —, sem "Realizada" e "Corrigir para Faltou", com a frase da presença; `cancelar-form.tsx` sem o campo de motivo para ela; `solicitacoes/page.tsx` com a nota "Pedidos de pessoas ainda sem cadastro ficam com a nutricionista."), `src/app/painel/rotas-da-recepcao.ts`, `src/modules/ajuda/conteudo.ts` (guia `recepcao-agenda`), `e2e/painel-rotas.ts`
- Test: `src/modules/agenda/recepcao.test.ts`, `src/app/painel/agenda/actions.test.ts` (casos da recepção em `describe` próprio), `src/app/painel/agenda/consultas/[id]/page.test.ts`

- [ ] **Step 1: Testes que falham:**
  - `recepcao.test.ts`: marcar, mover, cancelar (`cancelado_por = 'nutri'`, sem motivo), confirmar, "Faltou" depois do início → ok, com o ator dela no `audit_log`; "Faltou" com atendimento iniciado e a consulta ainda `agendada` → "Esta consulta tem um atendimento registrado." e nada gravado (RE-D62); "Realizada" → recusado no módulo e no banco; consulta de paciente bloqueado → "não encontrada"; `lerBloqueios` sem a chave `motivo`; pedido de paciente cadastrado aceito e recusado pela recepção (ator dela), pedido de pessoa nova fora da fila dela e `aceitarPedidoPublico` recusado na sessão dela (RE-D59); teste de fonte: só as funções de `FUNCOES_DA_RECEPCAO` usam `exigirEquipe`, as outras continuam `nutri`, e nenhuma delas (nem o que chamam no módulo) faz `from(<tabela negada>)` — a lista das negadas sai de `RECEPCAO_LIBERADO`.
  - `consultas/[id]/page.test.ts`: na sessão da recepção, nenhum link para `/painel/pacientes/`; "Abrir cadastro"; consulta cancelada (por ela ou pela nutricionista) sem o motivo e **sem** erro; sem "Iniciar atendimento" e sem "Cobrança" — com e sem a permissão do Financeiro (RE-D61).
  - **Por página da agenda liberada** (PM-R15; `page.test.ts` de cada uma, na sessão da recepção, com o espião de `LEITURAS_NEGADAS`): a grade e a lista (`agenda/page.tsx`: sem o link "Horários" e sem link para `/painel/pacientes/`), `nova` (sem `/painel/pacientes/`), `pendencias` (sem o botão "Realizada" e sem o link de registrar atendimento) e, do 23, `solicitacoes`, `imprimir` e as visões (`visoes.ts`): nenhum `/painel/pacientes/`, nenhum "Realizada", nenhum "Horários".
  - `actions.test.ts`: action fora da lista chamada pela recepção → "Sem permissão", nada gravado.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda src/app/painel/agenda src/app/painel/rotas-da-recepcao.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar sobre a agenda do 23 (rebase feito).
- [ ] **Step 4:** mesmo comando → PASS; E2E: a recepção marca, remarca, cancela e marca "Faltou"; abre a consulta e clica "Abrir cadastro"; aceita e recusa o pedido de um paciente cadastrado (23) e não vê o de pessoa nova; marca "Faltou" numa consulta com atendimento iniciado e recebe a recusa; imprime a agenda; axe das telas da agenda com a conta dela (IPs `10.9.36.20`–`.39`).
- [ ] **Step 5:** commit `feat(agenda): agenda pela recepção (P26-10)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (lista fechada, falha fechada, nenhuma leitura de tabela negada, pedidos do 23) e do `revisor-interface` (página da consulta, presença, telas da agenda) sem Critical/Important.

---

### Task 11a: Relatórios — Fase B do local e previsões de retorno (PR 3)

> Muda o produto da nutricionista (RE-D66): tarefa própria, antes das telas da recepção nos Relatórios.

**Files:**
- Modify: `src/modules/relatorios/{pacientes,atendimentos,planos,agenda,financeiro,ranking,registro}.ts` (filtro **Local**, RN-482: `locais_atendimento` e `appointments.local_id` do 23; local arquivado "(arquivado)"; `local` no `entidade_id`; Agenda com "Retornos previstos" e "Previstos com consulta marcada", RN-490, US-483, lendo `consultations.retorno_previsto_em` na sessão `nutri`), `src/modules/financeiro/resumo.ts` (`localId` em `recebidoEPagoPorMes` e `receitaPorPaciente`, pela regra da US-416 do 23), `src/app/painel/relatorios/{filtros,tabela}.tsx` e as páginas (o `<select>` "Local" só com o 23 e mais de um local, contando arquivados; Planos com o filtro desligado e a nota), `src/modules/relatorios/constantes.ts` (textos do local e das previsões), `src/modules/ajuda/conteudo.ts` (guia `relatorios` v2: a frase do local no `filtro-periodo`)
- Test: `src/modules/relatorios/secoes.test.ts` (`describe` "Fase B" no mesmo cenário, com locais e previsões), `src/app/painel/relatorios/page.test.ts`

- [ ] **Step 1: Testes que falham:**
  - Os cenários de local das US-480, US-481, US-483, US-484 e US-485; planos com o filtro desligado e a nota; consultório com um só local não mostra o filtro; local arquivado com "(arquivado)"; `entidade_id` com o id do local.
  - Agenda com o 23 (RN-490): `solicitada` fora de "Marcadas"; `pedido_desistido` em "Canceladas pelo paciente"; `pedido_recusado` e `pedido_vencido` em coluna nenhuma; "Retornos previstos" (previsão do último atendimento com previsão de cada paciente, no mês) e "Previstos com consulta marcada" (consulta marcada entre a previsão − 30 dias e o fim do mês).
- [ ] **Step 2:** `pnpm vitest run src/modules/relatorios src/modules/financeiro/resumo.test.ts src/app/painel/relatorios src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar sobre o 23 inteiro (rebase feito).
- [ ] **Step 4:** mesmo comando → PASS; `e2e/relatorios.spec.ts` com o local; pilha de carga do cenário "relatórios" com o filtro de local.
- [ ] **Step 5:** commit `feat(relatorios): local e previsões de retorno (P26-11a)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (local no `entidade_id`, previsões sem conteúdo clínico) e do `revisor-interface` (filtro de local, notas) sem Critical/Important.

---

### Task 11b: Financeiro e Relatórios da recepção, Equipe ligada e fechamento do PR 3 (PR 3)

**Files:**
- Modify: `src/modules/financeiro/erros.ts` (`exigirFinanceiro(ctx)`), `src/modules/financeiro/{lancamentos,resumo,telas,exportacao}.ts` (`exigirNutri` → `exigirFinanceiro`; `configuracoes.ts`, `cobranca.ts` e `titular.ts` não mudam, RE-D61; `travarLancamento` com falha fechada na recepção), `src/app/painel/financeiro/**` (menos `configuracoes`: `requireEquipe({ financeiro: true })`; actions devolvem o erro inline da RE-D47 sem a permissão), `src/app/painel/relatorios/**` e a rota do CSV (`requireEquipe`/`requireApiEquipe`; `podeVerSecao` com o acesso real; Pacientes na sessão da recepção sem "Bloqueados", com a nota; "Peça à nutricionista para configurar o Financeiro."), `src/modules/relatorios/{pacientes,agenda}.ts` (ramo da recepção: universo visível; "Retornos" por `app_retorno_das_consultas`; previsões por `app_previsoes_de_retorno`), `src/modules/plataforma/equipe-textos.ts` (`EQUIPE_LIGADA = true`), `src/app/painel/rotas-da-recepcao.ts` (Financeiro, Relatórios, CSV), `src/modules/ajuda/conteudo.ts` (guia `recepcao-financeiro`; `relatorios` com `papeis: ['nutri','recepcao']`), `test/carga/{seed.ts,cenario.js}` (a rodada do cenário "relatórios" também na sessão da recepção)
- Create: `e2e/equipe.spec.ts` (consultório **novo por execução**, molde `E2E_FIN_NOVO`: convidar, reenviar, permissão, desativar com a sessão dela aberta, reativar, limite de 3; RE-D46, RE-D69), `src/modules/financeiro/recepcao.test.ts`, `src/modules/relatorios/recepcao.test.ts`
- Test: `src/modules/financeiro/guardas.test.ts` (teste de fonte do 20: `exigirFinanceiro` em tudo menos as três exceções), `src/app/painel/financeiro/*.test.ts` (casos da recepção, com o espião de `LEITURAS_NEGADAS`)

- [ ] **Step 1: Testes que falham:**
  - `financeiro/recepcao.test.ts`: com a permissão, lança, recebe e cancela com o ator dela; sem a permissão → 0 linhas e recusa no banco; permissão tirada entre a leitura e a gravação → erro inline, nada gravado; paciente bloqueado → "não encontrado"; `configuracoes` → "Sem permissão"; `cobrancaDaConsulta`/`registrarCobrancaManual` na sessão dela → recusa (RE-D61).
  - `relatorios/recepcao.test.ts`: abas Pacientes e Agenda (+ Financeiro com a permissão); Ranking, Atendimentos e Planos → "Sem permissão" (página) e 303 (CSV por navegação); Pacientes da recepção = nutricionista − bloqueados − anonimizados, sem a chave `bloqueados`; "Retornos" e as previsões iguais nas duas sessões para pacientes visíveis; a taxa de faltas aparece para ela (RE-D63).
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro src/modules/relatorios src/app/painel/financeiro src/app/painel/relatorios src/app/painel/rotas-da-recepcao.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; pilha de carga do cenário "relatórios" na sessão da recepção (CS-483, p95 ≤ 800 ms com o `EXISTS` por linha em `appointments` e `fin_lancamentos`); `e2e/equipe.spec.ts`; `e2e/recepcao.spec.ts` completo (Financeiro com e sem a permissão; Relatórios da recepção; a recepção percorre `e2e/painel-rotas.ts` e cada rota fora da lista dá "Sem permissão"; **no fim, o `audit_log` não tem `ler` com o ator dela fora da entidade do cadastro**, R-482); `e2e/relatorios.spec.ts`; axe da Equipe (com a constante ligada) e das telas do Financeiro e dos Relatórios com a conta da recepção (IPs `10.9.36.40`–`.59`).
- [ ] **Step 5:** fechamento do PR 3: manual técnico cap. 04 (cadastro pela recepção, Equipe ligada, Relatórios), cap. 05 (agenda da recepção, pedidos do 23, Relatórios com local e previsões), cap. 07 (espião de leituras negadas, E2E da recepção), runbook completo; commit `feat(recepcao): Financeiro, Relatórios e Equipe ligada (P26-11b)`.

**Pronto quando:** testes e E2E verdes; revisão do `revisor-rls`, do `revisor-interface` e do `guardiao-manual` sem Critical/Important.

---

### Task 12: Fechamento do plano

**Files:**
- Modify: `src/modules/ajuda/conteudo.ts` (+ testes): versão + 1 sobre a da `main` nos guias que mudaram de texto e ainda não subiram (`configuracoes` pelo cartão "Equipe", `seguranca`, `financeiro`; o `boas-vindas` já subiu na T3 e o `relatorios` na T11a); conferir que cada rótulo citado entre aspas existe
- Modify: `docs/manual-tecnico/{02-banco-de-dados,03-autenticacao-e-acesso,04-modulos-clinicos,05-agenda-portal-conteudo,06-worker-seguranca-operacao,07-testes-qualidade-e-processo}.md` (conferir o que os fechamentos dos PRs escreveram) e o `README.md` (índice, glossário: `recepcao`, `RECEPCAO_LIBERADO`, `recepcao_cond_*`, `FUNCOES_COM_PAPEL`, `ROTAS_DA_RECEPCAO`) pelo `guardiao-manual`; `CLAUDE.md` (conferir as frases "Plano 26" das regras 1, 2 e 8); backlog (PD-100 e PD-101 entregues; itens da §2.2 "Fora"); índice dos planos; a spec (decisões RE-D49 a RE-D58 na §14; RE-D59 a RE-D69 já estão lá); `docs/superpowers/specs/2026-09-27-nutridebby-mvp-historias.md` (tabela "Textos de interface e mensagens" do Plano 26 no fim, com os textos da §6.2; RN-519)
- **Manual do usuário** (Docs `XgD7ujxhUajihUXa4Qf7yc`, o manual interno de 12 abas por público): aba nova "Recepção" (entrada com 2FA, Início, pacientes, cadastro, agenda, pedidos, Financeiro com a permissão, Relatórios), seção "Relatórios" e "Equipe" na aba da nutricionista, índice das abas e capturas novas (conta da recepção no banco de dev da sessão, nunca produção). **Central de Ajuda** (artifact `VCtjNoh3xPxTBsE9Y16Ld6`): `Artifact read` da versão atual, artigos novos "Relatórios" e "Equipe" (nutricionista) e uma seção "Recepção" com os artigos das tarefas dela, telas novas, `novoAte` de 30 dias; republicar no mesmo `url`. Se a sessão não tiver os conectores, entregar os textos e as capturas à orquestradora, que publica
- Pacote do advogado (E-09) e do CRN-3: P-R1 a P-R5 e o termo 1.0, pela orquestradora

- [ ] **Step 1:** guias e testes (`pnpm vitest run src/modules/ajuda`).
- [ ] **Step 2:** manuais técnicos, CLAUDE.md, backlog, índice, spec e tabela de textos das histórias.
- [ ] **Step 2b:** manual do usuário (Docs) e Central de Ajuda, com os destinos acima; registrar no PR os links e a versão publicada.
- [ ] **Step 3:** `pnpm test` inteiro (escalonado), `pnpm test:tempo`, `pnpm lint`, `pnpm typecheck`, E2E completo.
- [ ] **Step 4:** CS-484 combinado com a Debby (2 semanas com uma recepcionista), registrado no runbook.
- [ ] **Step 5:** commit `docs(recepcao): fechamento do Plano 26 (P26-12)`.

---

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (1, 2 e 3): revisão final do branch (workflow) com `revisor-rls` (PR 2 inteiro: listas, condições, gatilhos, `app_appointments_regras_pedido`, peças `SECURITY DEFINER`, entrada fora do painel, regeneração; PR 1: `exportar` e agregados; PR 3: falha fechada, projeções e rotas), `normas-cfn-lgpd` (PR 2: termo e §10; PR 3: cadastro), `revisor-interface` (todas as telas, guias por papel, axe) e `guardiao-manual` (fechamento), com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão **só do diff das correções** → `/security-review`. Sobrou Critical/Important confirmado: parar e avisar o dono. Merge só com o OK do dono.

Agentes por tarefa: `revisor-rls` (T2, T4, T5a, T5b, T6, T7, T9, T10, T11a, T11b), `normas-cfn-lgpd` (T7, T9, T12), `revisor-interface` (T1, T3, T6, T7, T8, T9, T10, T11a, T11b), `guardiao-manual` (fim de cada PR e T12). A sessão avisa a orquestradora a cada etapa (início, PR aberto, CI verde, revisão, pronto para merge) para o painel do backlog Paridade Dietbox.

---

## Conferência do plano contra o código (17/11/2026)

A revisão do plano (17/11, `revisor-rls` e crítico de completude) está na spec §18.5, com os achados aplicados e os descartes (pessoa nova pela recepção com marcador local; entrega por link segurada; "`unaccent` não existe"; condição `app_recepcao_ativa()`; Cobrança com `exigirFinanceiro`; dividir a T10 por módulo).

| Achado | Onde | Tratamento |
|---|---|---|
| O 20 PR 2 confere o papel por `exigirNutri(ctx)` (`src/modules/financeiro/erros.ts:42-44`), não por `ctx.role === 'nutri'` espalhado | `origin/plano-20-financeiro` | T11b cria `exigirFinanceiro` ao lado e troca nas chamadas, salvo `configuracoes.ts`, `cobranca.ts` e `titular.ts`; o teste de fonte do 20 (`guardas.test.ts`) ganha as exceções |
| Não existe página `/painel/preferencias`; só `actions.ts` com três actions `requireNutri` | `src/app/painel/preferencias/actions.ts:12,20,37` | T6 troca só `alternarTemaAction` e `marcarGuiaAction`; a RN-513 lista as actions, não uma página |
| Não existe rota pública `/termos/*` | `src/app` | T7 cria `src/app/termos/sigilo-equipe/page.tsx`; `/termos` fica fora de `PROTECTED` (`src/proxy.ts:7`) |
| O migrador aplica todas as migrations pendentes numa transação | `drizzle-orm/pg-core/dialect.js:60` | `lock_timeout` de 10 s na conexão do migrador (RE-D64, T4), valendo para a execução inteira; nada de `SET LOCAL` na custom |
| `consultaParaIniciarAtendimento` usa `exists (select … from consultations …)`: na sessão da recepção sempre "sem atendimento" | `src/modules/agenda/presenca.ts:24,139-144` | A página da consulta não a chama para a recepção (T10) |
| `motivoDoCancelamentoDaNutri` lança erro fora da sessão `nutri` e é chamada em toda consulta cancelada pela nutricionista | `src/modules/agenda/consultas.ts:278-279`, `consultas/[id]/page.tsx:37` | T10: não chamar para a recepção (RE-D44) |
| `reenviarConvitePaciente` serve ao paciente `sem_convite` (não exige convite anterior) | `src/modules/pacientes/convite-paciente.ts:123-139` | T9 reaproveita no "Enviar convite" da nutricionista, com a confirmação do e-mail |
| Os gatilhos de IA de `patients` (0099/0100) só recusam quando as colunas de IA mudam | `drizzle/0099_rls_ia.sql:49-54`, `0100:11-16` | O UPDATE da recepção (lista branca) passa; nada a mudar |
| `10.9.26.x` já está em `e2e/portal.spec.ts` | `e2e/portal.spec.ts` | Bloco `10.9.36.x` (RE-D50) |
| A semente apaga cada `user` do E2E por e-mail | `scripts/e2e-seed.ts:142-232` | Contas da recepção criadas uma vez (T6); Equipe e primeiro acesso em consultório novo por execução (T7, T11b; RE-D69); `equipe_membros` da semente gravada na sessão `nutri` (T6) |
| O `navegacao.test.ts` fixa "seis itens, nesta ordem" | `src/app/painel/navegacao.test.ts:10` | T3 (item Relatórios) e T8 (lista por papel) |
| O Plano 25 já decidiu nada para a recepção (C-442, CH-D33) | spec do 25 em `nutridebby-25` | Coordenação abaixo |
| **Revisão do plano (17/11):** o aceite e a recusa de pedido do 23 só valem para `nutri`; aceitar pessoa nova cria paciente `agendamento_publico`, `consents` e opt-in `paciente` | `plano-23-agenda-2:drizzle/0127_rls_agenda_2.sql:102-118`; spec do 23, RN-424 | RE-D59: `app_appointments_regras_pedido` refeito na custom (T5b); pessoa nova com a nutricionista (T10) |
| `registrarPresenca` procura `consultations` com o tx da sessão: vazio para a recepção | `src/modules/agenda/presenca.ts:41-43` | RE-D62: `app_consulta_tem_atendimento` (T5b, T10) |
| A assinatura entrega o link e o código a `patients.email` do paciente sem conta; o pedido de autorização de IA também | `src/modules/documentos/entrega.ts:30-46`, `registrar-assinatura.ts:98`, `link-documento.ts:195`, `src/modules/ia/autorizacao.ts:198,251` | RE-D60: confirmação do e-mail nas telas da nutricionista (T9) |
| O login, o 2FA e o "Continuar" da Segurança vão a `/inicio`, que só aceita `admin`, `nutri` e `paciente`; `/conta/outro-papel` também; `/api/sessao/ativa` só `admin` e `nutri` | `entrar/page.tsx:44`, `entrar/2fa/page.tsx:29`, `enable-2fa.tsx:67`, `inicio/page.tsx:8`, `conta/outro-papel/page.tsx:12,20`, `api/sessao/ativa/route.ts:9` | RE-D67 (T6) |
| `cobrancaDaConsulta` e `registrarCobrancaManual` chamam `exigirNutri`; há `cobranca-actions.ts` fora de `actions.ts` | `origin/plano-20-financeiro:src/modules/financeiro/cobranca.ts:130,161`; `consultas/[id]/cobranca-actions.ts` | RE-D61 (T10); o teste de fonte das rotas lê todo arquivo `'use server'` (T6) |
| O "Novo paciente" usa o `PacienteForm` com identidade de gênero, observação e WhatsApp; `novo/page.tsx` chama `situacaoDoWhatsapp`; a lista lê as etiquetas | `pacientes/paciente-form.tsx:126,150-162`, `novo/page.tsx:2,13`, `pacientes/page.tsx:6,36` | Variante do Novo e espião de `LEITURAS_NEGADAS` (T9) |
| A extensão `unaccent` existe, com `app_unaccent` | `drizzle/0000_base_roles_e_rls.sql:5`, `0040_rls_alimentos.sql:2`, `pacientes.ts:301` | RE-D68: empate do Ranking por `app_unaccent(lower(…))` (T2) |
| O migrador abre uma conexão e aplica todas as pendentes | `src/db/migrate.ts:9-13` | RE-D64: `lock_timeout` no `Pool` (T4) |
| A semente grava as tabelas do consultório do E2E em `worker` | `scripts/e2e-seed.ts:109,202` | RE-D69: `equipe_membros` pela sessão `nutri` com ator (T6) |
| As funções do 22 têm `IF r <> 'nutri' THEN RETURN NEW` | `nutridebby-22/drizzle/0127_rls_exames_catalogo.sql:57,88` | Decididas no Step 0 da T5b (tabelas negadas: "não se aplica") |
| O manual técnico tem papéis, sessão, guardas e convites no cap. 03 e contas no cap. 04 §4.1.1 | `docs/manual-tecnico/03-autenticacao-e-acesso.md`, `04-modulos-clinicos.md` | T8, T11b e T12 com os caps. 02, 03, 04, 05, 06 e 07 |

---

## Coordenação

Conferido em 17/11/2026: `nutridebby-b` (`plano-19-seed-usda`, 67b21d3), `origin/plano-20-financeiro` (411f21d, PR #55), `nutridebby-21` (1dab109), `nutridebby-22` (0d1ab95), `nutridebby-23` (spec e plano, 80c55ed) e `nutridebby-c` (`plano-23-agenda-2`, código em andamento, f660f60), `nutridebby-25` (spec v0.1, sem commit). Reconferir no início de cada PR.

| Onde | Quem | Conflito | Como resolver |
|---|---|---|---|
| `drizzle/` | 19, 21, 22, 23, 25 | Números, journal, `when` | §5; o PR 2 do 26 é o **último** da fila de migrations da onda 3; nada reservado |
| `app_enable_tenant_rls` | qualquer plano que o redefina | O 26 refaz o corpo | Corpo copiado da `main` na regeneração (hoje o da 0070); nenhum plano da onda o redefine (conferido) |
| Tabelas novas de 19, 21, 22, 23 e 25 | todos | Precisam nascer negadas à recepção | Antes do PR 2 do 26: o laço nega. Depois: `app_enable_tenant_rls` nega. Quem cria tabela depois só precisa do `FABRICAS` de sempre (a sessão `recepcao` entra nos casos genéricos) |
| `fin_lancamentos_regras`, `src/modules/financeiro/*`, `src/app/painel/financeiro/*` | 20 PR 2 (e PR 3); 23 T11 (Fase B no Financeiro) | Gatilho refeito, `exigirFinanceiro`, `requireEquipe` | PR 2 do 26 depois do 20 PR 2; PR 3 depois do 23 inteiro; corpo do gatilho da `main` |
| `src/modules/financeiro/{resumo,csv}.ts` | 20 PR 2 | Funções novas; `export` do escape | Só acrescentar no fim (T1, T2) |
| `src/app/painel/navegacao.ts` (+ teste) | 20 PR 2 ("Financeiro"), 25 ("Mensagens") | "Relatórios" e o filtro por papel | T3 depois do 20 PR 2; o item do 25 entra fora do menu da recepção (avisar a sessão do 25) |
| `src/app/painel/layout.tsx`, `page.tsx` | 23 (Solicitações, Aniversariantes), 25 (contador de mensagens) | Ramo da recepção | O Início da recepção é componente próprio; contador novo de outro plano fica fora do ramo dela por padrão |
| Agenda (`consultas`, `presenca`, `disponibilidade`, `cancelamento`, `visoes`, `solicitacoes`, `impressao`, páginas e actions) | 23 (todas as PRs; RN-400) | `exigirEquipe` nas funções da RN-509 | PR 3 só com o 23 inteiro; um ramo por papel; `FUNCOES_DA_RECEPCAO` fecha a lista |
| `src/app/painel/agenda/consultas/[id]/page.tsx`, `cancelar-form.tsx` | 20 PR 2 ("Cobrança"), 23 (local, Aceitar/Recusar) | Ramo da recepção | T10, depois dos dois |
| `src/modules/pacientes/pacientes.ts`, `src/app/painel/pacientes/page.tsx` | 23 T11 (filtro por local) | Projeção e menu da recepção | Rebase; um ramo por papel |
| `src/app/painel/pacientes/[id]/perfil/*` | 18 (na `main`) | Formulário reaproveitado | Extrair sem mudar a página da nutricionista (T9) |
| `src/app/painel/configuracoes/page.tsx` (`CARTOES`), guia `configuracoes` | 19, 22, 23 | Cartão "Equipe" | No fim; versão do guia + 1 uma vez, na T12, sobre a da `main` |
| `src/lib/{session-rules,tenant-session,session,auth}.ts`, `src/app/conta/*` | ninguém da onda (conferido) | Papel novo | Livre |
| `src/modules/plataforma/{convites,textos-versionados}.ts`, `src/app/convite/[token]/*` | 20 PR 2 (DPA 1.1 em `textos-versionados.ts`) | Termo `sigilo-equipe-1.0` | Só acrescentar; um texto legal por vez pela orquestradora |
| `src/modules/notificacoes/tipos.ts`, CHECK de `notifications.tipo` | 23 (pedidos), 25 (chat) | `TIPOS_DA_AGENDA` | Tipos de pedido de paciente cadastrado do 23 entram; os só de pessoa nova e os do 25 em `TIPOS_FORA_DA_RECEPCAO`; o teste da T5a obriga a decisão |
| `app_appointments_regras_pedido`, `app_tenants_agenda_da_equipe` (`0127_rls_agenda_2.sql` do 23) | 23 | A custom do 26 refaz `app_appointments_regras_pedido` com a recepção (RE-D59) | Corpo da `main` do momento no §5; se o 23 mudar a função depois do PR 2 do 26, mantém o papel `recepcao` (aviso pelo Step 0 da T5b) |
| Funções com papel de 19, 21, 22 e 25 | todos | `FUNCOES_COM_PAPEL` | Step 0 da T5b lista por `pg_proc` e decide; quem entrar depois do PR 2 do 26 decide as próprias (a guarda quebra sem a decisão) |
| `src/app/inicio/page.tsx`, `src/app/conta/outro-papel/page.tsx`, `src/app/api/sessao/ativa/route.ts` | ninguém da onda (conferir no Step 0 da T1) | Papel novo (RE-D67) | Livre |
| `src/modules/documentos/*`, `src/modules/ia/autorizacao.ts` e as telas | 22 (prescrição e documentos), conferir | Confirmação do e-mail (RE-D60) | Só as telas da nutricionista; rebase |
| `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `src/db/migrate-owner.test.ts`, `CLAUDE.md` | 19, 21, 22, 23, 25 | Entradas novas | Só acrescentar no fim de cada bloco; `describe` do 26 no fim do `migrate-owner.test.ts` |
| `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`) | 21, 22, 23, 25 | `relatorios`, `equipe` | Só acrescentar |
| `e2e/painel-rotas.ts`, `e2e/acessibilidade*.spec.ts`, `scripts/e2e-seed.ts` | 19, 20 PR 2, 21, 22, 23, 25 | Rotas, contas | Rebase; contas da recepção reaproveitadas; IPs `10.9.36.x` |
| `src/modules/ajuda/conteudo.ts`, `src/app/painel/guia/*`, `src/app/painel/ajuda/page.tsx` | 18, 19, 20, 22, 23, 25 | Guias e `guiaDaRota(caminho, papel)` | `papeis` opcional (padrão `['nutri']`): guia novo de outro plano não muda; na T8, atualizar todo chamador de `guiaDaRota` da `main` do momento |
| `next.config.ts` | 23 (cabeçalhos dos tokens e da impressão) | `no-store` dos Relatórios | Só acrescentar depois da regra `/:path*` |
| `test/carga/{seed.ts,cenario.js}` | 18, 19, 23 | Cenário "relatórios" | Só acrescentar |
| Plano 19 (`meal_plans`) | 19 | Publicação e versões | A RN-489 é conferida no rebase do PR 1 sobre o 19 |
| Plano 25 | 25 | Tabelas `chat_*`/`recados`, menu, contadores | Nada liberado à recepção; avisar a sessão do 25 pelo Step 0 da T5b (PM-R13) |

**Ordem no trem (proposta; a orquestradora decide):** … → 20 PR 2 → **26 PR 1** (sem migration, assim que o 20 PR 2 entrar) → PRs com migration da onda (19, 21, 22, 23 PR 1, 25) → **26 PR 2** (último com migration da onda 3) → 23 PRs 2 a 4 → **26 PR 3** (sem migration) → 26 T12. Se o 25 atrasar a ponto de travar o 26 PR 2, o 26 PR 2 pode entrar antes dele: as tabelas do 25 nascem negadas pelo `app_enable_tenant_rls` novo; o 25 (e os PRs 2 a 4 do 23 que tiverem migration) gera de novo as próprias migrations (§5, `when` crescente), decide as próprias funções em `FUNCOES_COM_PAPEL` e os próprios tipos em `TIPOS_FORA_DA_RECEPCAO`, e rebaseia o menu e o layout.

---

## Decisões

### Decisões da spec que este plano usa

RE-D1 a RE-D48 e RE-D59 a RE-D69 (spec §14), todas. As que mudam a forma das tarefas: RE-D1 (três PRs), RE-D9 (PDF pelo navegador: T3), RE-D15/RE-D16 (negação por padrão: T4, T6), RE-D23 (cadastro em rota própria: T9), RE-D27 (funções da RN-510: T5b), RE-D36 (Relatórios da recepção: T11b), RE-D37 a RE-D41 (revisão de banco: T5a, T5b, T9, T10, T11b), RE-D42 (guia por papel: T8), RE-D43 (último acesso: T6), RE-D44 (consulta: T10), RE-D45 (Segurança e acesso desativado: T6), RE-D46 (E2E: T6, T7, T11b), RE-D47 (Sem permissão: T6, T11b), RE-D48 (período: T1); da revisão do plano: RE-D59 (pedidos do 23: T5b, T10), RE-D60 (confirmação do e-mail: T9), RE-D61 (Cobrança: T10, T11b), RE-D62 (Faltou com atendimento: T5b, T10), RE-D63 (Início sem indicadores: T8), RE-D64 (`lock_timeout`: T4), RE-D65 (duplicidade: T9), RE-D66 (14 tarefas), RE-D67 (entrada fora do painel: T6), RE-D68 (Ranking por receita: T2), RE-D69 (E2E em consultório novo: T6, T7, T11b).

### Decisões novas deste plano (vão para a spec na T12)

| ID | Decisão | Porquê |
|---|---|---|
| RE-D49 | **O código roda numa sessão A, B ou C** criada pelo `sessao-paralela.sh`; o worktree `nutridebby-26` (só documento) sai antes | O script só conhece `a`, `b` e `c` e o mesmo branch não fica em dois worktrees (molde AG-D46 do 23) |
| RE-D50 | **Bloco de IP do E2E `10.9.36.x`** (`.1`–`.9` relatórios, `.10`–`.19` sessão e convite, `.20`–`.39` agenda e cadastro, `.40`–`.59` Financeiro e Equipe) | O `10.9.26.x` já é do `e2e/portal.spec.ts`; `10.9.36.x` está livre em todos os worktrees |
| RE-D51 | **PR 1 só com `requireNutri`**; `acesso.ts` já recebe o papel, e a troca para `requireEquipe` fica na T11b | Nenhuma rota fica aberta à recepção antes do banco que a recusa por padrão existir |
| RE-D52 | **Equipe atrás de `EQUIPE_LIGADA`**, desligada no PR 2 e ligada na T11b | Entre o PR 2 e o PR 3, uma recepcionista convidada em produção veria um Início com links para "Sem permissão" |
| RE-D53 | **PR 3 sem migration**: o PR 2 só abre com o 23 PR 1 na `main`, então a custom já cobre `locais_atendimento`, `app_appointments_regras_pedido` refeito (RE-D59), `app_consulta_tem_atendimento` e `app_previsoes_de_retorno` (`public_booking_requests` fica negada) | Um PR com migration a menos na fila; a recepção nasce com a matriz inteira |
| RE-D54 | **T4, T5a e T5b dividem a mesma custom** (blocos 1–2, 3 e 4–5 da §9.3; RE-D66), cada uma com ciclo e revisão próprios | Grande demais para uma revisão só; o `revisor-rls` recebe uma peça por vez (molde AG-D69 do 23) |
| RE-D55 | **A sessão `recepcao` entra nos casos genéricos do `test/isolamento.test.ts`**, com os comandos liberados lidos de `RECEPCAO_LIBERADO` | Uma fonte só; tabela nova de qualquer plano fica coberta sem ninguém lembrar |
| RE-D56 | **Funções `SECURITY DEFINER` da RN-510 testadas num `describe` no fim de `src/db/migrate-owner.test.ts`** | É o único cluster com dono `NOBYPASSRLS`, como em produção (molde AG-D54 do 23) |
| RE-D57 | **Tipos de notificação com decisão obrigatória**: `TIPOS_DA_AGENDA` + `TIPOS_FORA_DA_RECEPCAO` cobrem o CHECK inteiro | Tipo novo do 23 ou do 25 sem decisão quebra o teste em vez de ficar calado fora ou dentro |
| RE-D58 | **`exigirEquipe` em `src/modules/agenda/papel.ts`** com a lista `FUNCOES_DA_RECEPCAO` e teste de fonte | A troca de `ctx.role === 'nutri'` fica num lugar só, revisável, e as funções fora da lista continuam só da nutricionista |

### Decisões da orquestradora durante a execução (23/11/2026)

| ID | Decisão | Porquê |
|---|---|---|
| RE-D70 | **"Continuar na sessão"** no aviso de inatividade, para toda a equipe (nutricionista e recepção), no lugar de "Continuar conectada" | Um texto só e neutro em gênero, como a spec pede para a recepção; evita duas versões do mesmo aviso |
| RE-D71 | **Portão do PR 2:** o PR 2 não abre sem `app_cpf_em_uso` (função booleana `SECURITY DEFINER`, bloco 5 da T5b) e sem o uso dela em `conferirCpf` na sessão da recepção (adiantado da T9), com teste de que o CPF repetido — inclusive de paciente bloqueado — não chega ao 23505 | A condição de paciente visível esconde da recepção o cadastro do bloqueado; sem a função, o índice único recusa e o CPF vai ao log do Postgres (regras 2 e 3 do `CLAUDE.md`) |
| RE-D72 | **(Resolvida em 24/11/2026: o dono aprovou o texto, com a cl. 8 neutra e a cl. 7 com as cópias de segurança.)** **O merge do PR 2 espera o OK do dono sobre o texto do termo `sigilo-equipe-1.0`** (revisado pelo `normas-cfn-lgpd`; perguntas no pacote do advogado, E-09) | Texto legal novo (C-486) |
| RE-D73 | **Tipos novos do 23:** pedido_nao_confirmado em TIPOS_DA_AGENDA (aviso de pedido de paciente cadastrado, RN-428); aniversario em TIPOS_FORA_DA_RECEPCAO | A mensagem de aniversário é da nutricionista e depende de aniversario_autorizacoes, negada à recepção |
