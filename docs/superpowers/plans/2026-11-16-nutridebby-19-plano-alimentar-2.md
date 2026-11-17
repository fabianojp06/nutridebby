# Plano 19 — Plano alimentar 2 (Paridade Dietbox, onda 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o editor de plano alimentar ganha a USDA (e o lugar da TBCA), micronutrientes com perfis de referência, busca por nutriente e por equivalentes, texto livre por refeição, dias da semana por refeição, minhas refeições, listas de substituição e receitas/materiais ligados ao plano; o app do paciente passa a mostrar o dia certo e o que está ligado ao plano publicado.

**Architecture:** tudo como extensão de `foods`, `meal_plans`, `meals` e `meal_items` (RN-01 intacta: um publicado, um rascunho, publicado congelado), mais seis tabelas `staff_only` da biblioteca do consultório (`src/db/schema/biblioteca-plano.ts`) e duas ligações com `patient_id` (`plano_listas_substituicao`, `plano_conteudos`) auditadas e com `paciente_sem_rascunho`. Regras puras em `src/modules/plano-alimentar/dias.ts`, `src/modules/alimentos/{fontes,nutrientes}.ts` e `calculo.ts`. A exceção da RN-12 é ampliada na política de `contents`, com o mesmo marcador. O seed da USDA entra **num PR seguinte**, depois do deploy do código (spec D29).

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, actions e componentes cliente) · Drizzle · PostgreSQL 16 (RLS, pg_trgm) · pg-boss · `@react-pdf/renderer` (só no worker) · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-nutridebby-19-plano-alimentar-2-design.md` (v0.3: decisões aprovadas pelo dono em 16/11/2026; revisão das quatro lentes no §18 e revisão do plano no §19).

## Global Constraints

- **Ambiente da sessão B.** Worktree `../nutridebby-b`, branch `plano-19-plano-alimentar-2`, porta **3102**, banco **`nutri_dev_b`**. Preparo e reparo: `scripts/sessao-paralela.sh b plano-19-plano-alimentar-2` (na `main` desde o PR #50, 680eac3; roda `pnpm install --frozen-lockfile` e `pnpm db:migrate`). Dev: `pnpm exec next dev -p 3102`. E2E: `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e …` (a `APP_URL` só no comando, nunca exportada; pare o `pnpm worker` da sessão antes; **um E2E por vez entre as sessões**). Antes de qualquer comando de banco: `env | cut -d= -f1 | grep -E '^(DATABASE_URL|APP_URL|DATA_DIR)'` vazio. Suíte inteira (`pnpm test`, E2E) só quando a orquestradora liberar (limite de 3 sessões, `sessoes-paralelas.md` §2); por tarefa, rode só os testes listados.
- **Rodadas por diretório sem os testes de tempo.** Toda rodada `pnpm vitest run <diretório>` que alcance um `*.tempo.test.ts` (hoje `src/modules/alimentos/busca.tempo.test.ts` e `src/modules/plataforma/logo.tempo.test.ts`) leva `CI=1` na frente (`selecaoDosTestes` tira os de tempo). Tempo só com `VITEST_SO_TEMPO=1` e com a CPU liberada pela orquestradora.
- **Rebase.** Antes da Tarefa 1, `git rebase origin/main` (o branch nasceu em 5482450, antes do #50). De novo antes da Tarefa 10a e antes da Tarefa 11, para pegar o que tiver entrado (Plano 17; Plano 18 PR 1 e PR 2; Plano 20 PR 1). **O Plano 17 deve entrar na `main` antes do PR do código do 19** (ordem de merge combinada com a orquestradora): a parte dos lembretes da Tarefa 10d é obrigatória. Se no rebase da 10a o 17 ainda não estiver na `main`, **parar e avisar a orquestradora**: ou o 17 entra antes, ou o 17 leva o filtro por dia antes do merge dele (sem isso, há push em dia errado).
- **Nunca produção.** Nenhum subagente consulta o banco de produção, nem para ler. MCP `postgres-dev` aponta para o banco do principal, não para o da sessão: use `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_b`. Não faça push sem o controlador; merge só com OK do dono (merge = deploy; a migration roda no boot).
- **Migrations** (`sessoes-paralelas.md` §5): **nenhum número é reservado**. Gere com `pnpm db:generate` / `pnpm drizzle-kit generate --custom --name <nome>` sobre o que estiver no branch; antes do PR, a migration é **gerada de novo** sobre a `main` (procedimento no fim deste plano). Toda edição à mão numa migration gerada leva um comentário `-- Plano 19 (editado à mão): …` para o passo 1 do §5 achar. Rodar sempre com `DATABASE_URL_MIGRATOR` (regra 7). Uma custom `rls_<tabela>` por tabela nova (regra 2 do `CLAUDE.md`, spec §9.2).
- **Arquivos disputados** (`sessoes-paralelas.md` §6): `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `src/db/schema/index.ts`, `e2e/painel-rotas.ts`, `e2e/painel.ts`, `src/modules/ajuda/{conteudo,portal}.ts`, `docs/manual-tecnico/`, o índice dos planos e o backlog: **só acrescentar** no fim do bloco certo; nada de reordenar ou reformatar. **Exceções, avisadas à orquestradora no fechamento:** o texto de `CONTEUDO_POR_AUDIENCIA.contents` e o de `AUDIENCIA_EXIGE.contents` (Tarefa 1), os passos novos do guia `plano-alimentar` entre `editor-plano` e `publicar-plano` (Tarefa 7) e a frase dos chamadores de `liberarReceitasDoPlano` na regra 2 do `CLAUDE.md` (Tarefa 11) são edições no lugar.
- **Não editar** `src/modules/agenda/fuso.ts` (proibido também pelo plano do 20), `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx` (o 17 reidentou o arquivo inteiro) nem a assinatura de `BotaoAcao`/`AcaoPlanoState` (`botao-acao.tsx`, o 17 acrescentou a prop `nome`). Citar `rascunho-dados.ts`, `plano-ia.ts`, `ferramentas-alimentos.ts` e `metas-form.tsx` por símbolo, não por número de linha (o 18 mexe nos três primeiros).
- **Expansão, nunca contração.** A imagem antiga roda durante o boot do app novo e na volta atrás: coluna nova sempre com default que a imagem antiga satisfaça (`foods.fonte DEFAULT 'propria'` permanente, spec I-2); nenhuma coluna removida ou renomeada; nenhuma linha da USDA neste PR (D29). Job novo que a imagem antiga processaria errado ganha **fila nova** (Tarefa 10b, `plano-pdf-2`).
- **`foods` tem FORCE RLS e o migrator é `NOBYPASSRLS`.** Escrita de dados em `foods` numa migration só no molde da `drizzle/0042_seed_medidas_ibge.sql` (`ALTER TABLE foods NO FORCE ROW LEVEL SECURITY` … `FORCE`). **Proibido** criar política de escrita em `foods` para `tenant_id` nulo.
- Regras 1, 2, 3, 8 e 9 do `CLAUDE.md`: `withTenant`, RLS + guardas, nada de nome de alimento, texto livre, observação ou valor de nutriente em log/Sentry, `audit_log` pelo gatilho e `auditRead` ao devolver dado de saúde, `FABRICAS`.
- `calculo.ts` continua puro (sem banco nem React; teste de grafo da Tarefa 2). `lerCongelados` é o único leitor de `meal_items.nutrientes` (guarda da Tarefa 10d).
- Micronutrientes e perfil **nunca** nas telas do portal, no payload RSC do portal nem na cópia offline do app (CS-232); o PDF marcado e a exportação do titular os mantêm.
- Textos de interface em pt-BR, exatos da spec (§5, §6.1). Rotas do portal mantêm `?v=` do vínculo (`telaDoPortal`). Componentes base V2, alvos `min-h-11`, erros ao lado do campo com `role="alert"` e `aria-describedby`.
- Limites: 50 refeições e 400 itens no editor; 15 refeições e 200 itens em todo o caminho da IA (`MAX_*_RASCUNHO_IA`); 12 nutrientes exibidos; 5 listas e 10 conteúdos por plano; minha refeição até 40 itens (200 por consultório); lista até 20 grupos × 30 itens (100 por consultório). Limite por consultório conta com o tenant travado `FOR NO KEY UPDATE` (nunca `FOR UPDATE`: o KEY SHARE das FKs).

## Review Focus

1. **Imagem antiga e migration** — a migration aplica com o migrator sem superusuário (`migrate-owner.test.ts`), o preenchimento de `foods` fica certo (contagem por `fonte`) e um INSERT de `foods` sem `fonte` (o da imagem antiga) continua válido; o PDF do plano publicado pelo app novo nunca é gerado pelo worker antigo (fila `plano-pdf-2`). Tarefas 1 e 10b.
2. **RLS da biblioteca e das ligações** — as seis tabelas da biblioteca são `staff_only` (paciente, inclusive `semConta`, lê zero linhas); lista e conteúdo ligados só ao rascunho não aparecem ao paciente; o conteúdo fora da audiência só abre (texto e PDF) pelo caminho do plano e nunca conta "Quem viu". Tarefas 1 e 9.
3. **Dia da semana e fuso** — virada domingo 23:59 → segunda 00:00 no fuso do consultório (`America/Manaus`), cópia offline aberta no dia seguinte, "Comi assim" de outro dia recusado, total do dia por perfil (nunca a soma de dois "Almoço"), lembretes só das refeições do dia. Tarefas 2, 10a e 10d.
4. **Congelação** — plano publicado antes do deploy abre sem erro (formato antigo) e mostra "Micronutrientes não registrados nesta versão do plano."; publicado novo congela fonte, versão, `fonteOrigem`, micros e perfil; a publicação zera `referencia_id`; excluir perfil não toca publicado nem gera `audit_log` nele. Tarefas 4, 5 e 10b.
5. **IA** — as ferramentas da IA da nutricionista nunca devolvem USDA; o rascunho da IA fica em 15/200; a IA Nutri cita `#S` antes de `#L`, recebe texto livre mascarado, nunca micros nem perfil, com nova `PROMPT_VERSAO_CONVERSA`; o resumo da IA da nutricionista não manda o texto livre (D26). Tarefas 3, 4 e 10c.

---

## Ordem e fundação

Ordem **serial** no PR do código (as tarefas vizinhas mexem nos mesmos arquivos — `constantes.ts`, `ferramentas-alimentos.ts`, `rascunho-ia.ts`, `editor-plano.tsx`, `estado.ts`, `painel-totais.tsx`, `rascunho.ts`, `ajuda/conteudo.ts` —, então nenhum par roda em paralelo no mesmo worktree):

`1 → 2 → 3 → 4 → 7 → 5 → 6 → 8 → 9 → 10a → 10b → 10c → 10d → 11`; **12 no PR seguinte**, depois do deploy do PR do código (D29).

A Tarefa 7 vem antes da 5 porque o resumo de nutrientes da 5 usa o filtro de dia da 7.

- **Fundação (Tarefas 1 e 2):** `meals.dias_semana` e `src/modules/plano-alimentar/dias.ts` (`DiaDaSemana`, `ORDEM_DIAS`, `DIA_CURTO`, `rotuloDosDias`, `rotuloDosDiasPorExtenso`, `valeNoDia`); o Plano 17 entra antes, então é o 19 que aponta os lembretes para `dias.ts` (Tarefa 10d). Um PR de fundação separado não compensa mais (o 17 não importa `dias.ts`); só se faz se a orquestradora pedir porque o Plano 18 PR 2 quer contar `plano_conteudos` antes do 19 ficar pronto.
- **Contagem "No app" do Plano 18 (spec §13):** quem entra **depois** inclui `plano_conteudos` e a lista ligada na contagem. Se o 18 PR 2 estiver na `main` no rebase da 10a, é a Tarefa 10d que faz; se não, fica registrado no fechamento (Tarefa 11) como tarefa da sessão do 18, com a regra de usar a mesma projeção de `planoDoPaciente`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/db/schema/alimentos.ts` (modificar) | `fonte`, `fonte_ref`, `nome_original`, CHECKs, índice de grupo |
| `src/db/schema/plano-alimentar.ts` (modificar) | Colunas novas de `meal_plans` e `meals`; `plano_listas_substituicao`, `plano_conteudos` |
| `src/db/schema/biblioteca-plano.ts` (novo) | `referencias_nutrientes`, `refeicoes_modelo`, `refeicoes_modelo_itens`, `listas_substituicao`, `listas_substituicao_grupos`, `listas_substituicao_itens` |
| `drizzle/NNNN_*.sql` (gerada + custom `rls_<tabela>` × 8 e `plano19_fks_dias_conteudos`) | Colunas, tabelas, RLS, auditoria, FKs `SET NULL`, `app_dias_semana_validos`, política de `contents` |
| `src/modules/plano-alimentar/tipos-de-refeicao.ts` (novo, sem imports `@/`) | `TIPOS_DE_REFEICAO` (RN-250), importado pelo schema com caminho relativo |
| `src/modules/plano-alimentar/dias.ts` (novo) | Dias da semana, perfis de dia, rótulos, dia no fuso |
| `src/modules/alimentos/fontes.ts` (novo, sem imports `@/`) | `FONTES_DE_ALIMENTO`, `FONTES`, `TBCA_AUTORIZADA`, selo, sigla, citação, "Sem valor na …" |
| `src/modules/alimentos/nutrientes.ts` (novo) | Catálogo `NUTRIENTES` e formatação |
| `src/modules/plano-alimentar/congelados.ts` (novo) | `lerCongelados` (formato antigo e novo) |
| `src/modules/alimentos/{busca,alimentos,alimentos-constantes}.ts` (modificar) | Filtro de fonte, ordem, nome original, micros do "Meu alimento", textos por fonte |
| `src/modules/alimentos/referencias.ts` (novo) | Perfis de referência |
| `src/modules/alimentos/busca-avancada.ts` (novo) | Busca por nutriente e equivalentes |
| `src/modules/plano-alimentar/{refeicoes-modelo,listas,ligados}.ts` (novos) | Biblioteca e ligações |
| `src/modules/plano-alimentar/{calculo,constantes,tipos,carregar,rascunho,publicacao,modelos,plano-pdf,plano-pdf-job}.ts(x)` (modificar) | Micros, modo, dias, cópias, avisos, PDF |
| `src/app/painel/planos/editor/*` (modificar) + `dialogo-busca.tsx`, `nutrientes-do-paciente.tsx`, `ligado-ao-plano.tsx`, `filtro-dias.tsx` (novos) | Editor (usado em `[planId]/page.tsx` e em `planos/modelos/[id]/page.tsx`) |
| `src/app/painel/pacientes/[id]/plano-alimentar/botao-publicar.tsx` (novo) | Publicar com avisos em dois passos (D31) |
| `src/app/painel/planos/{refeicoes,listas,referencias}/**` (novos) | Telas da biblioteca |
| `src/app/painel/alimentos/**`, `src/app/api/painel/alimentos/**` (modificar/novo) | Selo, micros, filtros, equivalentes |
| `src/modules/portal/{plano,mural,diario,diario-constantes,lista-compras,conteudos}.ts`, `src/app/p/(portal)/{plano,inicio,compras,conteudos}/**`, `src/app/api/p/conteudos/[id]/pdf/route.ts` (modificar) | App do paciente |
| `src/modules/ia/{ferramentas-alimentos,plano-ia,rascunho-ia,rascunho-dados,resumo-dados}.ts`, `src/modules/ia/nutri-paciente/{contexto,instrucoes,validar-resposta,montar-resposta,textos}.ts` (modificar) | IA |
| `src/modules/lembretes/{slots,envio,equipe,config,constantes}.ts` (modificar; do Plano 17) | Lembretes por dia |
| `src/modules/pacientes/exportacao-job.ts` (modificar) | Exportação |
| `src/jobs/queues.ts`, `src/worker/index.ts` (modificar) | Fila `plano-pdf-2` |
| `scripts/usda/preparar-seed.ts`, `scripts/seeds/gerar-usda.ts`, `seeds/usda-*.csv` (Tarefa 12) | Seed USDA |
| `src/modules/ajuda/{conteudo,portal}.ts` (modificar) | Guia `biblioteca-do-plano` e versões |
| `e2e/painel-rotas.ts`, `e2e/painel.ts` (modificar) | Rotas novas e ids para o axe |

---

### Task 1: Banco — colunas, tabelas, RLS, auditoria e guardas (fundação)

**Antes:** `git rebase origin/main`; `scripts/sessao-paralela.sh b plano-19-plano-alimentar-2` (instala `node_modules` e migra o `nutri_dev_b`); só então ler `node_modules/next/dist/docs/` quando a tarefa pedir.

**Files:**
- Create: `src/modules/plano-alimentar/tipos-de-refeicao.ts` (`TIPOS_DE_REFEICAO`: "Café da manhã", "Lanche da manhã", "Almoço", "Lanche da tarde", "Jantar", "Ceia", "Outra"; sem imports `@/`) e `src/modules/alimentos/fontes.ts` só com `FONTES_DE_ALIMENTO = ['taco', 'usda', 'tbca', 'propria'] as const` e `type Fonte` (o resto entra na Tarefa 2; sem imports `@/`). O schema importa os dois com caminho relativo, como `GRUPOS_TACO` em `src/db/schema/alimentos.ts` ("o drizzle-kit não resolve o alias @/").
- Modify: `src/db/schema/alimentos.ts` — `fonte: text('fonte').notNull().default('propria')` (default **permanente**, comentário citando a spec I-2), `fonteRef: text('fonte_ref')`, `nomeOriginal: text('nome_original')`; CHECKs `foods_fonte_valida` (de `FONTES_DE_ALIMENTO`), `foods_fonte_ref_tamanho` (1–40), `foods_nome_original_valido`; `foods_origem_valida` refeito (`(tenant_id is null) = (fonte <> 'propria') and (fonte = 'propria') = (fonte_ref is null) and (taco_id is not null) = (fonte = 'taco')`); `foods_valores_faixa` com kcal até 1000; UNIQUE `foods_fonte_ref_unique (fonte, fonte_ref)`; índice `foods_grupo_idx`. O índice de trigramas de `nome_original` **não** entra aqui (vai na Tarefa 12, depois do INSERT).
- Modify: `src/db/schema/plano-alimentar.ts` — `meal_plans`: `modo` (default `'calculado'`, CHECK), `referenciaId`, `nutrientesExibidos` (`text[]`, default `'{}'`, CHECK ≤ 12), `referenciaCongelada` (jsonb, CHECK `is null or status <> 'rascunho'`), `macrosPrescritos` (jsonb, CHECK `is null or modo = 'livre'`), `mostrarMicrosPdf` (default false), CHECK `meal_plans_referencia_so_rascunho` (`referencia_id is null or status = 'rascunho'`); `meals`: `diasSemana` (`smallint[]`, default `'{0,1,2,3,4,5,6}'`; o CHECK com a função vai na custom), `descricaoLivre` (CHECK ≤ 2000); tabelas `plano_listas_substituicao` e `plano_conteudos` (spec §9.2; `conteudo` com CHECK `octet_length(conteudo::text) <= 524288` — pior caso da lista cheia, spec §9.2 v0.3; índice `(tenant_id, content_id) where content_id is not null`).
- Create: `src/db/schema/biblioteca-plano.ts` (as seis tabelas da spec §9.2; `refeicoes_modelo.tipo` com CHECK de `TIPOS_DE_REFEICAO`; `referencias_nutrientes` com `UNIQUE (tenant_id, id)`; FKs compostas com cascade; `food_id` RESTRICT); export em `src/db/schema/index.ts` (só acrescentar).
- Create: migration gerada (`pnpm db:generate`) **editada à mão**: entre o `ADD COLUMN` de `foods` e o `ADD CONSTRAINT` dos CHECKs novos de `foods`, o bloco `ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY;` → `UPDATE "foods" SET "fonte" = 'taco', "fonte_ref" = "taco_id"::text WHERE "tenant_id" IS NULL;` → `ALTER TABLE "foods" FORCE ROW LEVEL SECURITY;`, com comentário `-- Plano 19 (editado à mão): …`. Se o `drizzle-kit` gerar o CHECK antes do preenchimento de um jeito que a edição não resolva, regenere por etapas (§5, passo 4).
- Create: oito customs `rls_<tabela>` (regra 2), na ordem: `rls_referencias_nutrientes`, `rls_refeicoes_modelo`, `rls_refeicoes_modelo_itens`, `rls_listas_substituicao`, `rls_listas_substituicao_grupos`, `rls_listas_substituicao_itens` (cada uma: `app_enable_tenant_rls` + `app_enable_staff_only`), `rls_plano_listas_substituicao`, `rls_plano_conteudos` (cada uma: `app_enable_tenant_rls` + `app_enable_patient_rls` + política RESTRICTIVE `paciente_sem_rascunho`, molde da 0045, `EXISTS` em `meal_plans` com `status <> 'rascunho'` + `app_enable_audit('<tabela>', 'plano_alimentar')`). Custom `plano19_fks_dias_conteudos` — função `app_dias_semana_validos(smallint[])` `IMMUTABLE` com `SET search_path = pg_catalog, pg_temp` (vai num CHECK e passa pela restauração do backup, `test/restauracao.test.ts`; 1–7 valores, 0–6, ordem crescente, sem repetição, `array_position(d, NULL) IS NULL`) e CHECK `meals_dias_validos`; FKs `ON DELETE SET NULL (referencia_id)` e `SET NULL (content_id)` (molde da 0082); `DROP`/`CREATE` de `paciente_conteudo_visivel` com o ramo novo da RN-253 dentro do mesmo `current_setting('app.receitas_do_plano', true) = 'on'`.
- Modify: `src/db/rls-guard.ts` — `STAFF_ONLY` com as seis tabelas (motivo `'Plano 19: biblioteca do consultório; o paciente nunca vê'`, e `'… perfil de referência'` na primeira); `AUDIENCIA_EXIGE.contents` ganha os trechos normalizados do ramo novo (`fromplano_conteudos`, `pl.status='publicado'::text`), que `findConteudoAudienciaViolations` confere; o texto de `CONTEUDO_POR_AUDIENCIA.contents` (só o motivo) passa a citar "receita do plano ou conteúdo ligado ao plano publicado dele". As duas são edições no lugar (exceção avisada).
- Modify: `test/isolamento.test.ts`:
  - `FABRICAS` das oito tabelas. As fábricas de `plano_listas_substituicao` e `plano_conteudos` criam a `meal_plans` mãe no mesmo comando com status **`'arquivado'`**, no molde de `meals` (rascunho deixa a paciente sem linhas — `paciente_sem_rascunho`; publicado bate em `meal_plans_um_publicado_idx`). Em `plano_conteudos`, `content_id` fica **nulo** (regra 9: FK anulável fica de fora).
  - `COM_MAE` com as filhas (`refeicoes_modelo_itens`, `listas_substituicao_grupos`, `listas_substituicao_itens`, `plano_listas_substituicao`, `plano_conteudos`; mãe criada no mesmo comando por CTE). **Sem** filtro em `SO_APAGA.patients` (única FK é para `meal_plans`).
  - `ULTIMAS`: acrescentar **no fim**, nesta ordem, `'listas_substituicao_grupos', 'listas_substituicao', 'refeicoes_modelo'`. `listTenantTables` ordena por nome, então sem isso `listas_substituicao` é apagada antes de `_grupos`/`_itens` e `refeicoes_modelo` antes de `_itens`, e a cascata zera as linhas de B antes de o teste contá-las (`proprias.length >= 1` falha; o mesmo motivo de `contents`/`recipes` no comentário de `ULTIMAS`). As filhas `*_itens` (FK RESTRICT para `foods`) ficam fora de `ULTIMAS` e saem antes de `foods`.
- Modify: `src/db/migrate-owner.test.ts` — caso novo com o migrator sem superusuário.
- Test: `src/db/plano19-banco.test.ts` (novo).

**Interfaces:**
- Produces: `foods.fonte/fonteRef/nomeOriginal`, `mealPlans.{modo,referenciaId,nutrientesExibidos,referenciaCongelada,macrosPrescritos,mostrarMicrosPdf}`, `meals.{diasSemana,descricaoLivre}`, `referenciasNutrientes`, `refeicoesModelo`, `refeicoesModeloItens`, `listasSubstituicao`, `listasSubstituicaoGrupos`, `listasSubstituicaoItens`, `planoListasSubstituicao`, `planoConteudos` e os tipos `*Row`; `TIPOS_DE_REFEICAO`, `FONTES_DE_ALIMENTO`, `Fonte`.

- [ ] **Step 1: Testes que falham.** `plano19-banco.test.ts`:
  - `foods sem fonte continua válido` — INSERT pela sessão `nutri` com `tenant_id` e sem `fonte` grava `propria` (a imagem antiga).
  - `CHECK de origem` — `fonte = 'usda'` com `tenant_id` preenchido, `propria` com `fonte_ref`, `taco_id` com `fonte <> 'taco'` → violação; kcal 950 passa, 1001 recusa.
  - `nenhuma política de escrita em tenant_id nulo` — INSERT de `foods` com `tenant_id` nulo pela sessão `nutri` → 42501; UPDATE e DELETE de uma linha da TACO pela sessão `nutri` afetam **0 linhas** (a RLS esconde a linha; molde de `foods-rls.test.ts`); `pg_policies` não tem política de `foods` além de `tenant_isolation`, `taco_leitura` e as do `app_enable_tenant_rls`.
  - `dias_semana` — `{1,2,3,4,5}` passa; `{}`, `{7}`, `{3,1}`, `{1,1}` e `{1,NULL}` → violação.
  - `staff_only da biblioteca` — sessão de paciente (com conta e `semConta`) lê zero linhas das seis tabelas, mesmo com linhas no tenant.
  - `ligado ao rascunho não vaza` — `plano_listas_substituicao` e `plano_conteudos` de um rascunho: paciente lê 0; do publicado: lê 1.
  - `ligação só no próprio plano` — INSERT direto pelo tenant B em `plano_listas_substituicao`/`plano_conteudos` apontando para um plano do A → recusado; INSERT com `patient_id` diferente do paciente do plano → recusado pela FK composta `(tenant_id, plan_id, patient_id)` (a fábrica com `COM_MAE` só exercita a política de `meal_plans`).
  - `RN-12 ampliada` — conteúdo `orientacao` fora da audiência, ligado ao publicado: com `liberarReceitasDoPlano(tx)` o paciente lê; sem, não; ligado só ao rascunho, não lê nem com a liberação; **conteúdo em rascunho** ligado ao publicado → 0 linhas com a liberação; **conteúdo publicado ligado só a um plano arquivado** → 0 linhas com a liberação (`findConteudoAudienciaViolations` só procura trechos de texto); `paciente_conteudo_visto` continua recusando o INSERT com o marcador ligado.
  - `referencia_id só no rascunho` — `UPDATE meal_plans SET status = 'publicado'` com `referencia_id` preenchido → violação; excluir o perfil anula `referencia_id` do rascunho e não grava `audit_log` em nenhum plano publicado.
  - `lista cheia cabe` — `plano_listas_substituicao.conteudo` com 20 grupos × 30 itens, nomes de 120 caracteres acentuados, medida e valores no maior tamanho → grava (o CHECK de 512 KB cobre o pior caso dos limites).
  - `auditoria` — INSERT em `plano_listas_substituicao` e `plano_conteudos` pela `nutri` grava `audit_log` com entidade `plano_alimentar`; nas seis da biblioteca, nenhum.
  - `migrate-owner.test.ts`: depois de migrar com o migrator `NOSUPERUSER NOBYPASSRLS`, `select fonte, count(*) from foods group by fonte` dá só `taco` (as linhas da TACO, mesma contagem de `taco_id is not null`) e nenhuma `usda`/`tbca`; `relforcerowsecurity` de `foods` continua `true`.
- [ ] **Step 2:** `pnpm vitest run src/db/plano19-banco.test.ts src/db/migrate-owner.test.ts` → FAIL.
- [ ] **Step 3:** schema, `pnpm db:generate`, edição à mão, migrations custom, `pnpm db:migrate` no `nutri_dev_b`.
- [ ] **Step 4:** `pnpm vitest run src/db/plano19-banco.test.ts src/db/migrate-owner.test.ts src/db/migrate.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/modules/alimentos/foods-rls.test.ts src/modules/alimentos/taco-fonte.test.ts` → PASS. `pnpm drizzle-kit check` sem erro.
- [ ] **Step 5:** commit `feat(plano19): banco — fontes, dias, biblioteca e ligações com RLS e auditoria (P19-01)`.

**Pronto quando:** as guardas acusam a falta de qualquer uma das oito tabelas; `migrate-owner` passa sem superusuário; nenhuma linha `usda`/`tbca` existe.

---

### Task 2: Regras puras — dias, fontes, catálogo, micros e congelados (fundação)

**Files:**
- Create: `src/modules/plano-alimentar/dias.ts`, `src/modules/alimentos/nutrientes.ts`, `src/modules/plano-alimentar/congelados.ts`; completar `src/modules/alimentos/fontes.ts` (continua sem imports `@/`)
- Modify: `src/modules/plano-alimentar/calculo.ts` (`microsDoItem`, `totalMicros`, `totaisDoDia`, `itensComoTexto`), `src/modules/plano-alimentar/tipos.ts` e `src/db/schema/plano-alimentar.ts` (tipo `NutrientesCongelados` com `fonte`, `fonteVersao`, `fonteOrigem`, `micros`; `origem` fica), `src/modules/alimentos/taco.ts` (só `FONTE_TACO_TEXTO` reexportado de `FONTES.taco`; **`CAMPOS_MICRO` fica como está** — são as colunas da planilha em `COL_MICRO`, e o cabeçalho do CSV e o hash da INT-04 em `taco-fonte.test.ts` dependem delas; spec RN-235 e §4.1)
- Test: `dias.test.ts`, `fontes.test.ts`, `nutrientes.test.ts`, `congelados.test.ts`, `calculo.test.ts` (casos novos), `calculo-grafo.test.ts` (novo)

**Interfaces:**
- Produces:
```ts
// dias.ts — D28: único lugar de DiaDaSemana; os lembretes do 17 passam a importar daqui (Tarefa 10d)
export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo
export const ORDEM_DIAS: readonly DiaDaSemana[]; // [1,2,3,4,5,6,0] — seg…dom
export const DIA_CURTO: Record<DiaDaSemana, string>; // 'seg' … 'dom'
export const DIA_EXTENSO: Record<DiaDaSemana, string>; // 'Segunda' … 'Domingo'
export const TODOS_OS_DIAS: readonly DiaDaSemana[]; // [0..6]
export function rotuloDosDias(d: readonly DiaDaSemana[]): string;          // 'todos os dias' | 'seg a sex' | 'sáb e dom' | 'seg, qua e sex' (mesma saída do rotuloDosDias do 17)
export function rotuloDosDiasPorExtenso(d: readonly DiaDaSemana[]): string; // 'Todos os dias' | 'Segunda a sexta' | 'Sábado e domingo' | 'Segunda, quarta e sexta'
export function diaDaSemanaNoFuso(agora: Date, fuso: string): DiaDaSemana; // = diaDaSemana(partesNoFuso(agora, fuso).data), os helpers de agenda/fuso.ts que lembretes/slots.ts usa
export function valeNoDia(r: { diasSemana: readonly number[] }, dia: DiaDaSemana): boolean;
export function refeicoesDoDia<R extends { diasSemana: readonly number[] }>(refeicoes: R[], dia: DiaDaSemana): R[];
export type PerfilDeDia<R> = { dias: DiaDaSemana[]; refeicoes: R[] };
export function perfisDeDia<R extends { id: string; diasSemana: readonly number[] }>(refeicoes: R[]): PerfilDeDia<R>[]; // dias sem refeição ficam fora; ordem seg…dom
export function diasSemRefeicao(refeicoes: { diasSemana: readonly number[] }[]): DiaDaSemana[];
// fontes.ts (sem imports @/)
export const FONTES_DE_ALIMENTO: readonly ['taco', 'usda', 'tbca', 'propria'];
export type Fonte = (typeof FONTES_DE_ALIMENTO)[number];
export const TBCA_AUTORIZADA = false;
export const FONTES: Record<Exclude<Fonte, 'propria'>, { selo: string; sigla: string; citacao: string; versao: string; sha256?: string[] }>;
export function seloDaFonte(f: Fonte): 'TACO' | 'USDA (EUA)' | 'TBCA' | 'Meu alimento';
export function semValorNa(f: Fonte): string; // 'Sem valor na USDA'; na própria, 'Sem valor'
export function fontesVisiveis(carregadas: Fonte[]): Fonte[]; // nunca 'tbca' com TBCA_AUTORIZADA false
// nutrientes.ts
export type ChaveNutriente = (typeof NUTRIENTES)[number]['chave'];
export const NUTRIENTES: readonly { chave: string; nome: string; unidade: 'g' | 'mg' | 'mcg' | '%'; casas: number; fontes: Fonte[] }[]; // 31 chaves (RN-235)
export function formatarNutriente(chave: ChaveNutriente, valor: number): string; // vírgula decimal, 'µg'
export function microsValidos(m: unknown): { ok: true; valor: Record<ChaveNutriente, number> } | { ok: false; chave: string };
// calculo.ts (puro)
export type MicrosPorCem = Partial<Record<ChaveNutriente, number | null>>;
export type ItemComMicros = ItemCalculo & { micros: MicrosPorCem | null };
export function microsDoItem(i: { quantidadeG: number; micros: MicrosPorCem | null }): Partial<Record<ChaveNutriente, number>>;
export function totaisDoDia(refeicoes: { diasSemana: readonly number[]; itens: ItemCalculo[] }[], dia: DiaDaSemana): Nutrientes; // totalDoDia(refeicoesDoDia(refeicoes, dia))
export function totalMicros(refeicoes: { itens: ItemComMicros[] }[], chaves: readonly ChaveNutriente[]): Record<ChaveNutriente, { total: number; semValor: number }>; // só itens principais; para um dia, passe refeicoesDoDia(…)
export function itensComoTexto(itens: { id: string; nome: string; quantidadeG: number; medidaCaseiraTxt: string | null; substituiItemId: string | null }[]): string; // RN-245: "{nome} — {quantidade}" dos principais unidos por "; ", substituições " (ou {nome} — {quantidade})" depois do principal, cortado em 2000; usado na troca de modo (Tarefa 7) e na minha refeição carregada num plano livre (Tarefa 8)
// congelados.ts
export function lerCongelados(n: unknown): { nome: string; fonte: Fonte; fonteVersao: string | null; fonteOrigem: Fonte | null; kcal: number | null; proteinaG: …; micros: … | null };
```
- `lerCongelados`, formato antigo (sem `fonte`): `'TACO'` → `taco`, `'Meu alimento'` → `propria`, `micros: null`. Correto só porque nenhuma linha da USDA existe enquanto a imagem antiga pode publicar (D29) — comentário no código.
- `FONTES.usda.citacao`: `U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, {ano}. fdc.nal.usda.gov` (o ano e o sha256 são preenchidos na Tarefa 12; até lá, `FONTES.usda` existe mas nenhuma tela a mostra, porque não há linha `usda`). `FONTES.tbca.citacao` com o texto completo da RN-232 ("… Disponível em: http://www.fcf.usp.br/tbca. Acesso em: {data}.").

- [ ] **Step 1: Testes que falham.**
  - `dias.test.ts`: os quatro formatos de cada rótulo; ordem seg…dom (`rotuloDosDias([0,6])` → `sáb e dom`, `rotuloDosDiasPorExtenso([0,6])` → `Sábado e domingo`); `perfisDeDia` com "Almoço" seg–sex e "Almoço" sáb–dom → 2 perfis; todas as refeições nos 7 dias → 1 perfil; **Review Focus 3** `diaDaSemanaNoFuso(new Date('2026-11-16T03:59:00Z'), 'America/Manaus')` → 0 (domingo 23:59 local) e `…T04:00:00Z` → 1.
  - `nutrientes.test.ts`: 31 chaves únicas; `NUTRIENTES.filter((n) => n.fontes.includes('taco')).map((n) => n.chave)` igual a `CAMPOS_MICRO` (mesma ordem); `microsValidos({ sodio_mg: -3 })` e chave fora do catálogo recusados.
  - `fontes.test.ts`: `fontesVisiveis(['taco','usda','tbca','propria'])` sem `tbca`; `semValorNa('usda')` → `Sem valor na USDA`; **guarda da RN-232** (spec §16, item 1, no PR do código): com `TBCA_AUTORIZADA` false, nenhum `drizzle/*.sql` nem arquivo de `seeds/` contém `'tbca'` num INSERT (grep).
  - `congelados.test.ts`: formato antigo e novo.
  - `calculo.test.ts`: `totalMicros` ignora substituições e conta `semValor`; `totaisDoDia` com dois "Almoço" (seg–sex e sáb–dom) num sábado soma só o de sáb–dom; `itensComoTexto` dá `Arroz branco, cozido — 4 colheres de sopa; Feijão… (ou …)` e corta em 2000.
  - `calculo-grafo.test.ts`: com `grafoDeImports` (`test/grafo-de-imports.ts`), `calculo.ts`, `dias.ts`, `nutrientes.ts`, `fontes.ts` e `congelados.ts` não alcançam `@/db`, `drizzle-orm`, `pg`, `react` nem `next`.
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar/dias.test.ts src/modules/alimentos/fontes.test.ts src/modules/alimentos/nutrientes.test.ts src/modules/plano-alimentar/congelados.test.ts src/modules/plano-alimentar/calculo.test.ts src/modules/plano-alimentar/calculo-grafo.test.ts` → FAIL.
- [ ] **Step 3:** implementar (datas no fuso só com os helpers de `src/modules/agenda/fuso.ts`, sem editá-lo).
- [ ] **Step 4:** mesmo comando + `src/modules/alimentos/taco.test.ts src/modules/alimentos/taco-fonte.test.ts` → PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit `feat(plano19): dias da semana, fontes, catálogo de nutrientes e congelados (P19-02)`.

**Pronto quando:** `calculo-grafo.test.ts` verde, `taco-fonte.test.ts` verde sem mudança e todo leitor futuro tem `lerCongelados` para usar.

---

### Task 3: Fontes nos alimentos, nas receitas e na IA da nutricionista; micros no "Meu alimento"

**Files:**
- Modify: `src/modules/alimentos/busca.ts` (`buscarAlimentos(ctx, termo, db, o?: { fontes?: Fonte[]; grupo?: string })`; procura em `nome` e `nome_original`; ordem: começa com a 1ª palavra → fonte brasileira ou própria antes da USDA → semelhança → nome mais curto; `AlimentoEncontrado` ganha `fonte`, `nomeOriginal`, `micros`), `src/modules/alimentos/alimentos.ts` (`origem` de `foods.fonte`, não de `tenantId === null`; micros opcionais no cadastro e na edição, validados por `microsValidos`; "Duplicar" copia `micros` e `origem_food_id`; `exigirProprio` sem mudança), `src/modules/alimentos/alimentos-constantes.ts` (`KCAL_MAX = 1000`; `MSG_ALIMENTO.valores` com 1000; `taco` e `incompleto` com os textos da RN-230; **`emUso` só na Tarefa 8**), `src/modules/plano-alimentar/constantes.ts` (`MSG_PLANO.semValor` vira função da fonte, via `semValorNa`)
- Modify: `src/modules/plano-alimentar/carregar.ts` (no rascunho, `origem` do item pela fonte de `foods.fonte` via `seloDaFonte`, não por `f.tenantId === null`; o publicado passa a `lerCongelados` na Tarefa 4)
- Modify: `src/app/painel/alimentos/busca-alimento.tsx` (`Selo` por `Fonte`, `kcalTexto` por fonte, nome original em texto menor e o aviso "Nome traduzido automaticamente do inglês." visível no resultado da USDA), `src/app/painel/alimentos/[id]/page.tsx` (`valor()` por fonte; citação da fonte do alimento; aviso de tradução), `src/app/painel/alimentos/page.tsx` (fontes carregadas listadas), `src/app/painel/alimentos/alimento-form.tsx` (seção recolhida "Micronutrientes (opcional)", um campo por chave do catálogo, erro "Use um número de 0 a 100000." no campo), `src/app/painel/planos/editor/editor-plano.tsx` (o "Sem valor na …" do item pela fonte do item, hoje `MSG_PLANO.semValor` fixo)
- Modify: `src/modules/conteudo/receitas.ts` (`lerReceitaNaTransacao` e a montagem dos ingredientes: `origem` e `fonte` de `foods.fonte` via `seloDaFonte`), `src/app/painel/conteudos/[id]/receita-form.tsx` (selo e "Sem valor na …" por fonte), `src/app/p/(portal)/conteudos/[id]/page.tsx` (o "Sem valor na …" de cada ingrediente pela fonte do ingrediente — é a "página da receita no portal" da RN-230)
- Modify: `src/modules/ia/ferramentas-alimentos.ts` (`buscaDoTenant` passa `fontes: ['taco', 'propria']`), `src/modules/ia/rascunho-ia.ts` (a `origem` do item pela `foods.fonte`)
- Modify: `src/modules/ajuda/conteudo.ts` — guia `alimentos` 1 → 2 (resumo sem "A tabela TACO": "As tabelas públicas de composição (TACO) e os alimentos que você cadastrar ("Meu alimento"), com as medidas caseiras."; a USDA entra no resumo só na Tarefa 12, quando houver linhas)
- Test: `src/modules/alimentos/busca.test.ts`, `alimentos.test.ts`, `src/modules/conteudo/receitas.test.ts`, `src/modules/portal/conteudos.test.ts` (fonte do ingrediente), `src/modules/ia/ferramentas-alimentos.test.ts`, `src/app/api/painel/alimentos/route.test.ts`, `src/modules/ajuda/conteudo.test.ts`

- [ ] **Step 1: Testes que falham** (com linhas `usda` inseridas pela fábrica do teste no molde NO FORCE, só no Testcontainers; o banco do Vitest é um só para todos os arquivos, então as linhas são **apagadas no `afterAll`** pelo mesmo molde, e `foods-rls.test.ts` passa a contar `where fonte = 'taco'` em vez de `tenant_id is null`):
  - busca: "quinoa" traz o próprio e a TACO antes da USDA; "cooked quinoa" acha pelo `nome_original`; `fontes: ['usda']` só USDA; `tbca` nunca aparece.
  - **Review Focus 5** `ferramentas da IA nunca devolvem USDA` — `buscaDoTenant` com um alimento USDA que casa o termo → ausente.
  - receita com ingrediente USDA → selo `USDA (EUA)` no painel e `Sem valor na USDA` no portal quando falta kcal; `rascunho-ia` com alimento USDA (não deve vir da ferramenta, mas se vier pelo id) → origem pela fonte; rascunho do editor com item USDA → selo pela fonte.
  - "Meu alimento" com `calcio_mg: 120` salva; `sodio_mg: -3` → `{ 'micros.sodio_mg': 'Use um número de 0 a 100000.' }`; chave fora do catálogo recusada; kcal 950 salva (KCAL_MAX 1000).
  - "Duplicar" de alimento USDA: `micros` copiados, `origem_food_id` preenchido, aviso `MSG_ALIMENTO.incompleto` com "A USDA não tem todos os valores…".
  - textos: nenhum `'Sem valor na TACO'` literal fora de `fontes.ts` (teste de grep em `src/`, exceto testes).
  - `conteudo.test.ts`: guia `alimentos` na versão 2.
- [ ] **Step 2:** `CI=1 pnpm vitest run src/modules/alimentos src/modules/conteudo/receitas.test.ts src/modules/portal/conteudos.test.ts src/modules/ia/ferramentas-alimentos.test.ts src/app/api/painel/alimentos src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(alimentos): fonte do alimento na busca, nas receitas e na IA; micros do meu alimento (P19-03)`.

**Pronto quando:** nenhum código decide a fonte por `tenant_id` (`grep -rnE "tenantId === null \? \(?'TACO'|tenant_id is null then 'TACO'" src` só acha `publicacao.ts`, que a Tarefa 4 troca) e a IA só recebe TACO e próprios.

---

### Task 4: Publicação, cópias do plano, limites e avisos em dois passos

**Files:**
- Modify: `src/modules/plano-alimentar/publicacao.ts` (`publicarPlano`: congela `fonte`, `fonteVersao`, `fonteOrigem`, `micros` no `UPDATE … FROM foods`, fonte de `foods.fonte`; grava `referencia_congelada = { id, nome, fonte, valores }` e zera `referencia_id`; devolve `{ avisos }` sem publicar quando há aviso e `confirmarAvisos` não veio — sem VET no modo livre, dias sem refeição; `editarPublicado` copia o cabeçalho novo e o perfil de `referencia_congelada.id` se ele ainda for visível), `src/modules/plano-alimentar/carregar.ts` (o publicado lê `meal_items.nutrientes` só por `lerCongelados`), `src/modules/plano-alimentar/modelos.ts` (`salvarComoModelo`, `criarDeModelo`: cabeçalho novo), `src/modules/plano-alimentar/rascunho.ts` (`copiarConteudo`: `dias_semana`, `descricao_livre`, `plano_listas_substituicao`, `plano_conteudos` — o conteúdo copiado é travado `FOR SHARE` antes do INSERT, no molde da sugestão de receita em `salvarRascunho`, para um `excluirConteudo` concorrente não dar 23503; `validar`/`iguais`/`exigirPublicavel` com modo, dias, texto e `macros_prescritos`; mensagem "A refeição "{nome}" está sem texto." com a chave do campo), `src/modules/plano-alimentar/constantes.ts` (`MAX_REFEICOES = 50`, `MAX_ITENS = 400`, `MAX_REFEICOES_RASCUNHO_IA = 15`, `MAX_ITENS_RASCUNHO_IA = 200`, `MSG_PLANO.limite`, `MSG_PLANO.limiteRascunhoIa`, `MSG_TEXTO_LIVRE`, `MSG_DIAS` com "Escolha ao menos um dia da semana.")
- Modify (por símbolo): `src/modules/ia/rascunho-dados.ts` (limites do rascunho), `src/modules/ia/plano-ia.ts` (validação da saída da IA), `src/modules/ia/ferramentas-alimentos.ts` (limites de `calcular_plano`), `src/app/painel/pacientes/[id]/plano-alimentar/rascunho-ia/metas-form.tsx` (constantes e mensagem) — constantes e mensagem do rascunho da IA; `rascunho-ia.ts` ("Usar como rascunho": `modo = 'calculado'`, 7 dias)
- Create: `src/app/painel/pacientes/[id]/plano-alimentar/botao-publicar.tsx` (componente cliente próprio; **não** muda `BotaoAcao` nem `AcaoPlanoState`). Mantém o `exigirSalvo` e o `confirm` atual "Publicar esta versão para o paciente? A versão publicada hoje será arquivada." no primeiro toque (os helpers de E2E — `once('dialog')` + "Publicar" — continuam valendo). Se a action devolver `{ avisos: string[] }`, mostra os avisos em `role="alert"` junto do botão e o botão "Publicar mesmo assim" (D31), que publica com `confirmarAvisos` sem perguntar de novo; o erro de campo é link âncora que leva o foco ao campo.
- Modify: `src/app/painel/pacientes/[id]/plano-alimentar/actions.ts` (`publicarAction` aceita `confirmarAvisos` e devolve `avisos`) e `[planId]/page.tsx` (troca só o `BotaoAcao` do "Publicar" por `BotaoPublicar`, mantendo `data-guia="publicar-plano"`). **Não** mexer em `plano-alimentar/page.tsx`. `src/app/painel/planos/salvar-como-modelo.tsx`: aviso "Observações e textos das refeições vão para o modelo. Retire dados do paciente antes de salvar."
- Verify (sem mudança esperada): `e2e/portal.ts` e `e2e/plano-alimentar.spec.ts` (os planos que publicam têm os 7 dias e modo calculado, então não há aviso); ajustar só se algum publicar plano com aviso, e avisar o 18, que edita os mesmos arquivos.
- Test: `publicacao.test.ts`, `modelos.test.ts`, `rascunho.test.ts`, `carregar.test.ts` (novo), `src/modules/ia/{rascunho-dados,plano-ia,ferramentas-alimentos}.test.ts`, `src/app/painel/pacientes/[id]/plano-alimentar/actions.test.ts`

- [ ] **Step 1: Testes que falham:**
  - **Review Focus 4** `plano publicado antes do deploy` — linha com `nutrientes` no formato antigo: `carregarPlano` e o PDF leem sem erro; `lerCongelados` dá `taco`/`propria`.
  - publicar congela `fonte`, `fonteVersao`, `micros` e `referencia_congelada`; `referencia_id` do publicado é nulo; editar o perfil depois não muda o publicado.
  - `Editar` num publicado em texto livre → rascunho `modo = 'livre'` com os textos, `dias_semana` e `macros_prescritos`; com o perfil ainda existente, `referencia_id` = `referencia_congelada.id`; excluído → nulo.
  - `salvarComoModelo`/`criarDeModelo` copiam modo, dias, texto, listas e conteúdos ligados (cópia, sem reler a biblioteca).
  - avisos: modo livre sem `meta_kcal` → `{ avisos: ['Registre o VET, a distribuição de macro e micronutrientes e as quantidades da prescrição no plano ou no atendimento.'] }` e nada publicado; com `confirmarAvisos` publica; domingo sem refeição → `Domingo não tem refeições.`; sábado e domingo → `Sábado e domingo não têm refeições.`.
  - refeição livre sem texto → erro com o texto exato; `macros_prescritos` que não somam 100 → `A soma de proteína, carboidrato e lipídio precisa dar 100%.`; refeição com `dias_semana` vazio no salvamento → `Escolha ao menos um dia da semana.` no campo (antes do CHECK).
  - limites: 50 refeições salvam, 51 recusam com `O plano pode ter até 50 refeições e 400 itens.`; rascunho da IA com 16 refeições → `O rascunho da IA pode ter até 15 refeições e 200 itens.`; saída da IA com 16 refeições → `null` em `plano-ia.ts`.
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar src/modules/ia/rascunho-dados.test.ts src/modules/ia/plano-ia.test.ts src/modules/ia/ferramentas-alimentos.test.ts "src/app/painel/pacientes/[id]/plano-alimentar/actions.test.ts"` → FAIL.
- [ ] **Step 3:** implementar (ordem de travas de sempre: paciente → tenant → plano).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): publicação com fonte e micros, cópias completas, limites e avisos em dois passos (P19-04)`.

---

### Task 7: Editor — texto livre e dias da semana

(Roda **antes** da Tarefa 5: o resumo de nutrientes da 5 usa o filtro de dia daqui.)

**Files:**
- Create: `src/app/painel/planos/editor/filtro-dias.tsx` (grupo de botões com `aria-pressed`: "Todos", "seg" … "dom"; legenda "seg a sex: 1.820 kcal · sáb e dom: 2.050 kcal" e "{dia}: sem refeições"; em "Todos" com perfis diferentes, a tabela dos perfis e "Escolha um dia para ver os detalhes.")
- Modify: `src/app/painel/planos/editor/{editor-plano.tsx,estado.ts,painel-totais.tsx,navegacao.ts}` — seletor "Como montar o plano" ("Com alimentos e quantidades" / "Texto livre por refeição") com os `confirm` da troca (RN-245, dentro do editor); caixa "O que comer" (`descricao_livre`); "Meta (kcal)" e "Distribuição prescrita (opcional)"; caixas "Dias de {refeição}" (`<fieldset>`, `min-h-11`, erro "Escolha ao menos um dia da semana." ao lado); cartão com `rotuloDosDias`; totais e meta **por dia** (`totaisDoDia`); "Aparece para o paciente no app." (`aria-describedby`) na observação e no texto livre; nomes acessíveis com os dias quando o nome da refeição se repete ("Horário de Almoço (seg a sex)"); no modo livre some "Mostrar calorias ao paciente" ("Nutrientes do paciente" some no modo livre na Tarefa 5)
- Modify: `src/modules/plano-alimentar/rascunho.ts` (troca de modo pelo salvamento de sempre: calculado → livre usa `itensComoTexto` da Tarefa 2; livre → calculado apaga texto e `macros_prescritos`), `src/modules/ajuda/conteudo.ts` (guia `plano-alimentar`: passos `modo-plano` e `dias-refeicao` com `data-guia`, **entre** `editor-plano` e `publicar-plano` — ordem final `editor-plano` → `modo-plano` → `dias-refeicao` → `publicar-plano` → `lembretes-app` (do 17); `versao` = a da `main` + 1 (3 com o 17 na `main`); atualizar em `conteudo.test.ts` o `toBe` da versão do guia `plano-alimentar`, achado pelo conteúdo, não pelo número da linha)
- Test: `estado.test.ts`, `navegacao.test.ts`, `rascunho.test.ts`, `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/planos/editor/estado.tempo.test.ts` (novo)

- [ ] **Step 1: Testes que falham:** troca calculado → livre gera o texto de `itensComoTexto`; livre → calculado limpa texto e macros; banco nunca grava `descricao_livre` com itens no calculado (RN-243); filtro "sáb" mostra só as refeições de sábado e os totais de sábado; legenda com "dom: sem refeições"; nomes acessíveis únicos com dois "Almoço"; **PM-PA9** `estado.tempo.test.ts` (fora da suíte paralela do CI, `test/arquivos-de-tempo.ts`): recálculo síncrono de `estado.ts` com 50 refeições e 400 itens abaixo de 16 ms por tecla (registrar o número no commit; a medição de verdade da RNF-230 é no E2E da Tarefa 11).
- [ ] **Step 2:** `pnpm vitest run src/app/painel/planos/editor src/modules/plano-alimentar/rascunho.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL (o `estado.tempo.test.ts` só com `VITEST_SO_TEMPO=1 pnpm vitest run src/app/painel/planos/editor/estado.tempo.test.ts`, com a CPU liberada).
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): texto livre por refeição e dias da semana no editor (P19-07)`.

---

### Task 5: Perfis de referência e "Nutrientes do paciente"

**Files:**
- Create: `src/modules/alimentos/referencias.ts` (`listarReferencias`, `salvarReferencia`, `excluirReferencia`; nome 1–80 único, fonte 2–300 obrigatória, valores por chave com `meta`/`maximo`, ao menos um nutriente, `meta ≤ maximo`), `src/app/painel/planos/referencias/page.tsx` (lista e o link "Novo perfil" para `/painel/planos/referencias/novo`), `.../referencias/[id]/page.tsx` (com `id = 'novo'`, o formulário vazio; salvar cria e redireciona para o id real; id que não é UUID nem `novo` → `notFound`; a spec tem só as seis rotas, sem `/novo` próprio), `.../referencias/actions.ts`, `.../referencias/referencia-form.tsx`
- Create: `src/app/painel/planos/editor/nutrientes-do-paciente.tsx` (perfil, até 12 nutrientes, linhas "Ferro: 12,4 mg · meta 18 mg (69%)", "Acima do máximo (2300 mg)" em texto, "{n} itens sem valor de {nutriente}", "Ver todos os nutrientes", caixa "Mostrar no PDF os nutrientes escolhidos" desabilitada com "Ligue antes "Mostrar calorias ao paciente"."; no publicado em formato antigo, "Micronutrientes não registrados nesta versão do plano."; some no modo livre; valores do dia escolhido no filtro da Tarefa 7, por `totalMicros(refeicoesDoDia(…))`)
- Modify: `src/app/painel/planos/editor/{editor-plano,estado,painel-totais}.tsx/ts`, `src/modules/plano-alimentar/{carregar,rascunho}.ts` (salvar `referencia_id`, `nutrientes_exibidos`, `mostrar_micros_pdf`; leitura com `referencia_congelada` no publicado), `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx` **e** `src/app/painel/planos/modelos/[id]/page.tsx` (os dois abrem o `EditorPlano`: passar a lista de perfis), `src/app/painel/configuracoes/page.tsx` (cartão "Perfis de referência" no fim de `CARTOES`)
- Modify: `src/modules/ajuda/conteudo.ts` — guia novo `biblioteca-do-plano` (versão 1, `padrao: /^\/painel\/planos\/(refeicoes|listas|referencias)(\/.*)?$/`, resumo e passos sem alvo, como `modelos`; o passo de perfis diz que a plataforma não traz valores prontos)
- Modify: `e2e/painel-rotas.ts` (`/painel/planos/referencias` e `/painel/planos/referencias/[id]`; chave nova `referencia` em `IdsDoPainel`) e `e2e/painel.ts` (`prepararTelasComId` cria um perfil pela interface — `/painel/planos/referencias/novo`, nome com o `sufixo`, fonte e uma meta — e devolve o id da URL)
- Test: `src/modules/alimentos/referencias.test.ts`, `.../referencias/actions.test.ts`, `src/app/painel/planos/editor/estado.test.ts`, `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/rotas-axe.test.ts`

- [ ] **Step 1: Testes que falham:** salvar sem fonte → `Informe a fonte dos valores (ex.: DRI/IOM 2006, IN 75/2020 da ANVISA).`; sem valor → `Informe a meta ou o máximo de pelo menos um nutriente.`; nome repetido recusado; outro tenant não vê (RLS); lista vazia mostra o texto exato da US-232; a confirmação de excluir tem o texto exato da spec e, depois, o rascunho fica "Sem perfil" e o publicado não muda; 13º nutriente → `Escolha até 12 nutrientes.`; o resumo do editor por dia usa `totalMicros` das refeições do dia; o resumo de um publicado em formato antigo mostra `Micronutrientes não registrados nesta versão do plano.`; guia `biblioteca-do-plano` casa as rotas novas.
- [ ] **Step 2:** `pnpm vitest run src/modules/alimentos/referencias.test.ts src/app/painel/planos src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): perfis de referência e nutrientes do paciente (P19-05)`.

---

### Task 6: Diálogo "Buscar alimento" — Lista, Nutrientes e Equivalentes

**Files:**
- Create: `src/modules/alimentos/busca-avancada.ts` (`buscarPorNutriente(ctx, { chave, direcao, grupo?, fontes? })` — `chave` do catálogo **ou macro** (`kcal`, `proteinaG`, `carboidratoG`, `lipidioG`, `fibraG`, RN-241); só com valor, até 20, desempate por nome; `equivalentes(ctx, { foodId, quantidadeG, igualarPor, fontes? })` — mesmo grupo, valor > 0, quantidade `ref × v_ref ÷ v_cand` arredondada a 1 g entre 0,1 e 5000; por energia ordena pela soma das diferenças de P/C/L; por nutriente filtra energia ±10% e ordena pela diferença de energia; até 20; devolve o texto do critério), `src/app/api/painel/alimentos/equivalentes/route.ts`, `src/app/painel/planos/editor/dialogo-busca.tsx` (`<dialog>` nativo, `aria-labelledby`, abas com `tablist`/`tab`/`tabpanel` e setas, foco no campo ao abrir e volta ao botão que abriu, contagem em `role="status"`, "Adicionado a {refeição}." em `role="status"`, diálogo aberto para vários itens, aba Equivalentes desabilitada sem item com o texto da spec, "Ver nutrientes" sem sair do diálogo, critério e "Sugestão: confira antes de usar." visíveis, link "Não encontrou? Cadastrar meu alimento (abre em outra aba)" com `rel="noopener"`)
- Modify: `src/app/api/painel/alimentos/route.ts` (parâmetros `fonte`, `grupo`, `nutriente`, `direcao`), `src/app/painel/planos/editor/editor-plano.tsx` (botão "Mais opções de busca" **dentro de cada refeição**, com a refeição como destino; ação "Equivalentes de {item}" em cada item, cujo escolhido entra como substituição com a quantidade sugerida)
- Test: `src/modules/alimentos/busca-avancada.test.ts`, `src/app/api/painel/alimentos/route.test.ts`, `.../equivalentes/route.test.ts`, `src/app/painel/planos/editor/estado.test.ts`; `busca.tempo.test.ts` ganha por nutriente e equivalentes com a TACO (o volume da USDA é medido na Tarefa 12)

- [ ] **Step 1: Testes que falham:** "Rico em ferro" ordena do maior ao menor e exclui nulos, com o critério `Ordenado por ferro em 100 g (maior primeiro).`; "Pobre em sódio" com grupo, critério `… (menor primeiro).`; "Rico em proteína" (macro `proteinaG`) funciona; equivalentes do arroz 120 g por energia dão o macarrão com a quantidade da fórmula; por carboidrato só os de energia ±10%; critério exato ("Mesmo grupo (Cereais e derivados) · mesma energia · ordenados pela proximidade de proteína, carboidrato e lipídio."); toda resposta com resultado traz `Sugestão: confira antes de usar.`; vazio → `Nenhum alimento atende a este critério.`; alimento próprio de outro tenant nunca aparece; `estado.test.ts`: "Adicionar como substituição" cria o item com `substituiItemId` do item de referência.
- [ ] **Step 2:** `CI=1 pnpm vitest run src/modules/alimentos/busca-avancada.test.ts src/app/api/painel/alimentos src/app/painel/planos/editor` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS; `VITEST_SO_TEMPO=1 pnpm vitest run src/modules/alimentos/busca.tempo.test.ts` só quando a orquestradora liberar CPU.
- [ ] **Step 5:** commit `feat(plano): diálogo de busca com nutrientes e equivalentes (P19-06)`.

---

### Task 8: Biblioteca — minhas refeições e listas de substituição

**Files:**
- Create: `src/modules/plano-alimentar/refeicoes-modelo.ts` (salvar do editor sem observação por padrão; "Incluir a observação"; carregar no rascunho com ids novos, 7 dias, horário salvo, valores atuais; no plano livre os itens viram texto por `itensComoTexto` (Tarefa 2); até 40 itens e 200 por consultório), `src/modules/plano-alimentar/listas.ts` (CRUD; nome único; orientação ≤ 1000; 20 grupos × 30 itens; 100 listas; energia calculada na hora); as duas conferem que cada `food_id` é **visível** na sessão antes de gravar (molde da conferência `visiveis` de `salvarRascunho` em `rascunho.ts`, RN-258); os limites por consultório contam com o tenant travado `FOR NO KEY UPDATE` antes do INSERT (sem TOCTOU)
- Create: `src/app/painel/planos/refeicoes/{page.tsx,[id]/page.tsx,actions.ts,refeicao-form.tsx}` (minha refeição nasce só pelo editor, "Salvar como minha refeição"; a lista não tem "Nova"), `src/app/painel/planos/listas/{page.tsx,[id]/page.tsx,actions.ts,lista-form.tsx}` (link "Nova lista" para `/painel/planos/listas/novo`, mesmo padrão do `[id] = 'novo'` da Tarefa 5; "Sugerir equivalentes" abre o diálogo da Tarefa 6 com o primeiro item do grupo; o campo de orientação leva "Aparece para o paciente no app." abaixo do rótulo, com `aria-describedby`, RN-254)
- Modify: `src/app/painel/planos/editor/editor-plano.tsx` ("Salvar como minha refeição" com o aviso "Confira o nome e os itens: retire dados do paciente antes de salvar." e, ao marcar a observação, "A observação pode ter dados do paciente. Revise antes de salvar."; "Carregar minha refeição"), `[planId]/page.tsx` e `planos/modelos/[id]/page.tsx` (passar as minhas refeições ao `EditorPlano`), `src/app/painel/configuracoes/page.tsx` (cartões "Minhas refeições" e "Listas de substituição"; cartão "Alimentos" com "TACO, USDA e os seus alimentos." só na Tarefa 12), `src/modules/alimentos/alimentos-constantes.ts` (`MSG_ALIMENTO.emUso` da RN-258 — só aqui), `src/modules/ajuda/conteudo.ts` (passos de `biblioteca-do-plano`; `configuracoes` = versão da `main` + 1 com o resumo citando a biblioteca; atualizar o `toBe` da versão de `configuracoes` em `conteudo.test.ts`, achado pelo conteúdo)
- Modify: `e2e/painel-rotas.ts` (4 rotas: `/painel/planos/refeicoes`, `/painel/planos/refeicoes/[id]`, `/painel/planos/listas`, `/painel/planos/listas/[id]`; chaves novas `minhaRefeicao` e `lista` em `IdsDoPainel`) e `e2e/painel.ts` (`prepararTelasComId`: no rascunho da versão 2 que já abre para o modelo, "Salvar como minha refeição" de uma refeição; a lista por "Nova lista" com nome com o `sufixo`; devolve os ids)
- Test: `refeicoes-modelo.test.ts`, `listas.test.ts`, `.../refeicoes/actions.test.ts`, `.../listas/actions.test.ts`, `src/modules/alimentos/alimentos.test.ts` (alimento em uso numa lista → mensagem nova), `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/rotas-axe.test.ts`

- [ ] **Step 1: Testes que falham:** salvar sem observação por padrão e com ela quando marcada; carregar dá ids novos, 7 dias e horário; num plano livre entra como texto (`itensComoTexto`); 41º item, 21º grupo (`A lista pode ter até 20 grupos e 30 itens por grupo.`) e 31º item recusados; 201ª refeição e 101ª lista recusadas, também com dois salvamentos concorrentes no limite; `food_id` de alimento próprio de outro tenant → erro de campo, nada gravado; excluir alimento usado numa minha refeição ou lista → `Este alimento está em uso (plano, receita, minha refeição ou lista de substituição) e não pode ser excluído.`; paciente lê zero linhas (reaproveita a guarda da Tarefa 1).
- [ ] **Step 2:** `CI=1 pnpm vitest run src/modules/plano-alimentar/refeicoes-modelo.test.ts src/modules/plano-alimentar/listas.test.ts src/app/painel/planos src/modules/alimentos/alimentos.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): minhas refeições e listas de substituição (P19-08)`.

---

### Task 9: Ligado ao plano — lista, receitas e materiais; RN-12 ampliada

**Files:**
- Create: `src/modules/plano-alimentar/ligados.ts` (`ligarLista` grava a cópia com `fonteOrigem` por item; `atualizarDaBiblioteca` só no rascunho, "A lista de origem foi excluída." quando sumiu; `removerLista`; `ligarConteudo`/`desligarConteudo` com título copiado — `ligarConteudo` trava o conteúdo `FOR SHARE` antes do INSERT, no molde da sugestão de receita de `salvarRascunho`, para um `excluirConteudo` concorrente não dar 23503; até 5 listas e 10 conteúdos, `O plano pode ter até 5 listas e 10 receitas ou materiais.`), `src/app/painel/planos/editor/ligado-ao-plano.tsx` ("Cópia de {data}. Mudanças na biblioteca não alteram este plano.", "Não publicado — o paciente não vê", "{título} (excluído)")
- Modify: `src/modules/conteudo/audiencia.ts` (só o comentário: "conteúdos do plano"), `src/modules/portal/conteudos.ts` (`caminhoDoPdfDoConteudo(ctx, id, db, o?: { doPlano?: boolean })` chama `liberarReceitasDoPlano(tx)` só com `doPlano`; o comentário de `conteudoDoPaciente` deixa de dizer "só a entrega se for receita de refeição do plano" e passa a "receita do plano ou conteúdo ligado ao plano publicado dele"), `src/app/api/p/conteudos/[id]/pdf/route.ts` (`?de=plano` → `doPlano: true`), `src/app/p/(portal)/conteudos/[id]/page.tsx` (`?de=plano` já existe para receita; vale para todo tipo ligado; **o link do PDF leva `?de=plano` quando `c.soPeloPlano`**, senão a rota dá 404 para a orientação fora da audiência), `src/modules/plano-alimentar/carregar.ts` (`PlanoCompleto` ganha `listas` e `conteudos`, sem mudar assinaturas usadas pelo 17), `[planId]/page.tsx` e `planos/modelos/[id]/page.tsx` (passar listas e conteúdos disponíveis ao `EditorPlano`), `src/modules/plano-alimentar/rascunho.ts` (`copiarConteudo` copia `plano_conteudos` com o conteúdo travado `FOR SHARE`, se a Tarefa 4 não tiver feito)
- Modify: `src/modules/portal/conteudos.test.ts` — guarda dos chamadores de `liberarReceitasDoPlano` (achada pelo conteúdo): em `conteudos.ts`, **duas** chamadas, uma em `conteudoDoPaciente` e outra em `caminhoDoPdfDoConteudo`; em `plano.ts`, uma em `planoDoPaciente`; feed, busca, favoritos, visualização e `conteudosNovosNaTransacao` nunca ligam.
- Test: `ligados.test.ts`, `src/modules/portal/conteudos.test.ts`, `src/app/api/p/conteudos/[id]/pdf/route.test.ts`, `src/app/p/(portal)/conteudos/[id]/page.test.ts` (novo: link do PDF)

- [ ] **Step 1: Testes que falham:** a cópia não muda quando a lista da biblioteca é editada; "Atualizar da biblioteca" troca a cópia só no rascunho; a lista cheia (20 × 30, nomes no limite) liga e atualiza sem erro; **Review Focus 2** orientação fora da audiência ligada ao publicado abre pelo plano (texto por `conteudoDoPaciente(…, { doPlano: true })` e PDF por `caminhoDoPdfDoConteudo(…, { doPlano: true })` e pela rota com `?de=plano`) e não abre pelo feed, pela busca, pelos favoritos; a página do conteúdo aberto pelo plano monta o link do PDF com `?de=plano`; abrir pelo plano não grava em `content_views`; ligada só ao rascunho não abre nem com `?de=plano`; despublicada não abre com `?de=plano` e fica "Não publicado — o paciente não vê" no editor; excluída fica `content_id` nulo com o título. (A projeção da página Plano, que tira o conteúdo despublicado, é testada na Tarefa 10a.)
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar/ligados.test.ts src/modules/portal/conteudos.test.ts "src/app/api/p/conteudos" "src/app/p/(portal)/conteudos"` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `src/db/rls-guard.test.ts test/isolamento.test.ts` + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): lista de substituição, receitas e materiais ligados ao plano (P19-09)`.

---

### Tasks 10a–10d: Leitores do plano publicado

Checklist fechado (RN-247, PM-PA8): editor (Tarefa 7), mural, página Plano, próxima refeição, "Comi assim", `versaoDaCopiaOffline`, lista de compras (10a), PDF (10b), contexto da IA Nutri e resumo da IA da nutricionista (10c), exportação, lembretes e "No app" do Plano 18 (10d). Leitores do **total do dia**: editor, PDF, Plano, mural, IA Nutri.

**Antes da 10a:** `git rebase origin/main` (Global Constraints: o 17 tem de estar na `main`; ver se o 18 PR 2 e o nome social do 18 entraram).

### Task 10a: App do paciente — Plano, mural, diário e lista de compras

**Files:**
- Modify: `src/modules/portal/plano.ts` (`planoDoPaciente` com projeção **fechada**: dias, `descricaoLivre`, perfis com total por dia, `listas` inline (energia do item só com `mostrar_calorias`), `conteudos` só publicados; manter a forma "receitas com `disponivel`" que o teste de paridade do 18 usa; `proximaRefeicao` com dias e texto "Próxima: amanhã às {hh:mm}" / "Próxima: {dia} às {hh:mm}"; `versaoDaCopiaOffline` com id, título e situação dos conteúdos ligados e o hash das listas), `src/modules/portal/mural.ts` (só as refeições de hoje; vazio do dia "Seu plano não tem refeições para hoje."), `src/modules/portal/diario.ts` + `diario-constantes.ts` (`refeicaoDoPlanoPublicado` só aceita refeição que vale hoje; `MSG_DIARIO.refeicaoDeOutroDia = 'Esta refeição não é de hoje.'`; **sem mudar** as assinaturas de `rotuloDaRefeicao` e `refeicaoDoDiario`, que os lembretes do 17 importam), `src/modules/portal/lista-compras.ts` (por dia da janela; lê os congelados por `lerCongelados`; texto livre fora com os dois avisos da RN-248)
- Modify: `src/app/p/(portal)/plano/page.tsx` + componente cliente novo `dia-de-hoje.tsx` (recebe os 7 dias e o fuso; marca "Hoje ({dia})" com o relógio do aparelho; "Ver outros dias" `min-h-11`; seção "Ligado ao seu plano" com "Lista de substituição" inline e "Receitas e materiais do seu plano" com "Abrir precisa de internet." e links `?de=plano`; textos de usuário com `whitespace-pre-line wrap-break-word`), `refeicao-detalhe.tsx` (`valeHoje`: fora do dia esconde as três ações e mostra "Você responde a esta refeição no dia dela."; texto livre como "Sua nutricionista:", sem kcal), `src/app/p/(portal)/plano/refeicao/[id]/page.tsx` (outro dia = só leitura), `src/app/p/(portal)/inicio/page.tsx` (mural do dia; **manter** o `temLembretes` no `Promise.all` e a prop `comLembretes` do 17), `src/app/p/(portal)/compras/page.tsx`
- Test: `src/modules/portal/{plano,mural,diario,lista-compras}.test.ts`, `src/app/p/(portal)/plano/page.test.ts`, `src/app/p/(portal)/inicio/page.test.ts`

- [ ] **Step 1: Testes que falham:**
  - **CS-232** chaves fechadas de `planoDoPaciente`, do mural e da lista de compras (molde de `documentos.test.ts`); nenhum valor de micro nem nome de perfil no `JSON.stringify` da resposta; `plano_conteudos.titulo` de conteúdo despublicado ausente (o conteúdo despublicado some do app).
  - **CS-233 / Review Focus 3** `America/Manaus`, domingo 23:59 local → mural e Plano com as de domingo; segunda 00:00 → as de segunda; "Comi assim" de refeição de sábado num domingo → `Esta refeição não é de hoje.`, nada gravado; próxima depois da última de sábado sem refeição no domingo → "Próxima: seg às 07:30".
  - total do dia com dois "Almoço" (seg–sex 600 kcal, sáb–dom 800 kcal) num sábado → só o de 800 entra.
  - item da lista ligada com energia só com `mostrar_calorias` ligado (RN-252); sem ele, nenhuma kcal na lista.
  - `versaoDaCopiaOffline` muda ao despublicar um conteúdo ligado e ao atualizar a lista.
  - lista de compras de 7 dias a partir de uma quarta soma o almoço de seg–sex 3 vezes (qua, qui, sex) + 2 da semana seguinte (seg, ter).
- [ ] **Step 2:** `pnpm vitest run src/modules/portal "src/app/p/(portal)/plano" "src/app/p/(portal)/inicio"` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(portal): dia da semana e ligado ao plano no app do paciente (P19-10a)`.

### Task 10b: PDF do plano

**Files:**
- Modify: `src/modules/plano-alimentar/plano-pdf.tsx` + `plano-pdf-job.ts` (lê os congelados por `lerCongelados`; um bloco por perfil com `rotuloDosDiasPorExtenso` e total do dia; "{n} refeições por dia" por perfil; texto livre, meta e distribuição; nutrientes escolhidos e referência só com `mostrar_micros_pdf` e `mostrar_calorias`; publicado em formato antigo sem micros, com "Micronutrientes não registrados nesta versão do plano." se as duas caixas estiverem ligadas; "Lista de substituição" no fim; conteúdos ligados **publicados** no fim; rodapé "Fontes:" com as fontes usadas, inclusive `fonteOrigem` e listas, e "Nomes de alimentos da USDA traduzidos do inglês." quando houver item da USDA)
- Modify: `src/jobs/queues.ts` e `src/worker/index.ts` — **fila nova `plano-pdf-2`** (mesmas opções de `plano-pdf`), registrada só pelo worker novo; o worker novo também consome `plano-pdf` (jobs do app antigo na janela do deploy). `publicarPlano` e `editarPublicado` passam a enfileirar em `plano-pdf-2`. Motivo (revisão do plano, banco I-2): o worker antigo continua de pé até o novo subir e geraria, para um plano publicado no app novo, um PDF sem dias e sem `descricao_livre` (no texto livre, a prescrição some) marcado `pronto` até a próxima publicação. `expirar-plano-pdf` continua igual (olha o plano, não a fila).
- Test: `src/modules/plano-alimentar/plano-pdf-job.test.ts`, `publicacao.test.ts` (enfileira em `plano-pdf-2`), `src/worker/filas-plano-pdf.test.ts` (novo: `src/worker/index.ts` registra `plano-pdf` e `plano-pdf-2` com o mesmo handler; lendo o fonte, se o registro não for exportável)

- [ ] **Step 1: Testes que falham:** dois perfis com título e total; rodapé com TACO e USDA quando houver; sem micros sem as duas caixas; formato antigo com as caixas → o texto de micros não registrados; conteúdo despublicado fora; `publicarPlano` enfileira em `plano-pdf-2`; o worker trata `plano-pdf` e `plano-pdf-2` com o mesmo handler.
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar/plano-pdf-job.test.ts src/modules/plano-alimentar/publicacao.test.ts src/worker` → FAIL.
- [ ] **Step 3:** implementar; **PM-PA9**: medir o PDF com 50 refeições e 400 itens **e** com 5 listas cheias (20 × 30) e 10 conteúdos, e registrar no commit.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): PDF por dia da semana, ligado ao plano e fila nova (P19-10b)`.

### Task 10c: IA Nutri e resumo da IA da nutricionista

**Files:**
- Modify: `src/modules/ia/nutri-paciente/contexto.ts` (lê os congelados por `lerCongelados`; dias de cada refeição e o dia de hoje; trecho `#R` do modo livre = `descricao_livre` mascarada; lista como `#L{lista}-{grupo}`, tipo `lista_substituicao`, fonte "Lista de substituição — {grupo}", mascarada; `relerTrechos` relê a cópia do publicado; kcal do dia do perfil de hoje; os trechos novos passam pela mesma máscara com `outrosNomes` — e com o nome social, se o 18 já estiver na `main`), `instrucoes.ts` (`SISTEMA_CONVERSA` com `#L` e "substituição: #S ou #L"; **nova `PROMPT_VERSAO_CONVERSA`**), `validar-resposta.ts` (`PREFIXOS.substituicao = ['#S', '#L']`), `montar-resposta.ts` (ordena `#S` antes de `#L`), `textos.ts` (se precisar); `src/modules/ia/resumo-dados.ts` (lê por `lerCongelados`; D26: refeição livre vai sem itens e sem o texto; nada novo sai)
- Test: `src/modules/ia/nutri-paciente/{contexto,instrucoes,validar-resposta,montar-resposta}.test.ts`, `src/modules/ia/resumo.test.ts` (o que `resumo-dados.ts` manda), `src/modules/ia/campos-enviados.test.ts`

- [ ] **Step 1: Testes que falham:** contexto com dias e "hoje"; lista mascarada com `#L`; `validarSaida` aceita `#L` em `substituicao`; **Review Focus 5** `montarResposta` com fontes `['#L1-1', '#S2']` cita `#S2` primeiro; nenhum micro nem nome de perfil no contexto; `PROMPT_VERSAO_CONVERSA` diferente da `conversa-2026-10-14`; `campos-enviados.test.ts`: um marcador em `descricao_livre` e outro na orientação da lista não aparecem no que o resumo da IA da nutricionista envia (D26), e o nome do paciente (e o nome social, se o 18 já estiver na `main`) dentro de `descricao_livre` e da orientação da lista sai mascarado no contexto da IA Nutri; nenhum arquivo do 19 em `src/modules/ia/**` contém `fin_` (guarda do 20, se já estiver na `main`).
- [ ] **Step 2:** `CI=1 pnpm vitest run src/modules/ia` → FAIL.
- [ ] **Step 3:** implementar; **PM-PA9**: medir o tamanho do contexto da IA Nutri com 50 refeições e 400 itens **e** com 5 listas cheias, e registrar no commit (se o contexto passar do orçamento de tokens da IA Nutri definido no Plano 15, parar e avisar o controlador: o limite volta a ser discutido, R-239).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(ia): IA Nutri com dias, texto livre e lista de substituição (P19-10c)`.

### Task 10d: Exportação, ajuda do portal, lembretes, "No app" e guarda dos congelados

**Antes:** se o 18 ou o 20 entraram na `main` depois do rebase da 10a, rebase de novo (a exportação junta os literais de `DadosExportacao` dos quatro planos).

**Files:**
- Modify: `src/modules/pacientes/exportacao-job.ts` (`planosParaExportacao`: campos da RN-257, congelados por `lerCongelados`; no `titular`, conteúdo ligado só se existir e estiver publicado; juntar com os campos do 17, do 18 e do 20 que estiverem na `main`; atualizar os literais de `DadosExportacao` em `exportacao.test.ts`)
- Modify: `src/modules/ajuda/portal.ts` (página Plano com dias; "Ligado ao seu plano" com a ressalva "quando a sua nutricionista ligar"; `versao` = a da `main` + 1; ajustar `portal.test.ts`)
- Modify (lembretes; obrigatório, o 17 está na `main`): `src/modules/lembretes/slots.ts` (`RefeicaoDoPlano` ganha `dias`; `planoDoDia` pula a refeição fora do dia; `maiorDiaDaSemana` conta por dia), `envio.ts` e `equipe.ts` (a leitura do plano publicado traz `dias_semana`; "previsto para hoje" em `lembretesDoPaciente` só com as refeições de hoje), `config.ts` (`DiaDaSemana` reexportado de `dias.ts`) e `constantes.ts` (`ORDEM_DIAS`, `DIA_CURTO` e `rotuloDosDias` importados de `dias.ts`; o `constantes.test.ts` do 17 continua verde — as saídas são as mesmas)
- Modify (só se o 18 PR 2 estiver na `main`): `src/modules/ficha/no-app.ts` (`noAppDoPaciente` conta os `plano_conteudos` do publicado com `contents.status = 'publicado'` na parte `nutri`, como as receitas do D24 do 18 — nunca com `liberarReceitasDoPlano` nem no `semConta` — e a lista ligada) e o teste de paridade dele (CS-261/RNF-263 b) com o caso novo. Se o 18 PR 2 não estiver na `main`, nada aqui: registrar no fechamento (Tarefa 11) como tarefa da sessão do 18.
- Test: `src/modules/pacientes/exportacao.test.ts`, `src/modules/ajuda/portal.test.ts`, `src/modules/lembretes/{slots,envio,equipe,constantes}.test.ts`, `src/modules/plano-alimentar/congelados.test.ts` (guarda), e os do `no-app` se aplicável

- [ ] **Step 1: Testes que falham:**
  - exportação: `titular` sem conteúdo excluído nem despublicado; `equipe` com "{título} (excluído)"; micros e `referencia` presentes nos dois escopos.
  - lembretes: refeição só de seg a sex não gera slot no sábado; dois "Almoço" (seg–sex e sáb–dom) geram um slot por dia, o do dia; o teto de 24 (`maiorDiaDaSemana`) conta só as refeições de cada dia; "previsto para hoje" e o "já registrou?" do diário olham só as refeições de hoje.
  - "No app" (se aplicável): conteúdo ligado publicado conta; despublicado e ligado só ao rascunho não.
  - **guarda dos congelados** (`congelados.test.ts`, teste de fonte): `NutrientesCongelados` só aparece em `congelados.ts`, `publicacao.ts` (que grava) e no schema; os leitores conhecidos (`carregar.ts`, `resumo-dados.ts`, `lista-compras.ts`, `exportacao-job.ts`, `plano-pdf-job.ts`, `nutri-paciente/contexto.ts`) importam `lerCongelados`; nenhum outro arquivo de `src/` lê `.nutrientes` de `mealItems`.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/exportacao.test.ts src/modules/ajuda/portal.test.ts src/modules/lembretes src/modules/plano-alimentar/congelados.test.ts` (+ `src/modules/ficha` se aplicável) → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): exportação, ajuda do portal e lembretes por dia (P19-10d)`.

---

### Task 11: Fechamento do PR do código — E2E, acessibilidade, manuais e ajuda

**Antes:** `git rebase origin/main`; pedir à orquestradora o **bloco de IP** do E2E (as quatro sessões vão pegar um; livres em 17/11: 10.9.1, 10.9.4, 10.9.21 a 10.9.25 e de 10.9.30 em diante) e o horário do E2E.

**Files:**
- Create: `e2e/plano-alimentar-2.spec.ts` (bloco de IP da orquestradora, comentado no cabeçalho; relógio fixo com `page.clock` na virada domingo → segunda; navegação por URL, nunca pela aba "Resumo" — o 18 PR 1 renomeia — nem por `getByLabel('Nome')` do paciente — o 18 PR 2 troca por "Nome completo"; nomes de lista e de perfil gerados a cada execução)
- Modify: `e2e/acessibilidade-painel.spec.ts` (no laço claro/escuro/aparelho: diálogo aberto em cada aba, editor com filtro de dia, aviso de publicação), `e2e/acessibilidade.spec.ts` (`/p/plano` com dois perfis, lista e conteúdos ligados; 320 px com fonte a 200% e texto livre com link longo), `scripts/e2e-seed.ts` e `test/carga/seed.ts` (acréscimos **idempotentes** — `onConflictDoNothing`, `listas_substituicao.nome` único por tenant e um rascunho por paciente: um **paciente e um plano novos** com seg–sex e sáb–dom, lista e orientação ligadas; **não** alterar os planos que já existem no seed, que os E2E do 17 e do 18 usam e não podem depender do dia da semana em que o CI roda)
- Modify: `CLAUDE.md` (regras 1, 2 e 8: frase do Plano 19 no fim — seis tabelas `staff_only`, as duas ligações auditadas com `paciente_sem_rascunho`, a RN-12 ampliada, proibição de política de escrita em `foods` com `tenant_id` nulo; **e, no lugar**, a frase da regra 2 que diz que `liberarReceitasDoPlano` é "chamada só por `planoDoPaciente` e por `conteudoDoPaciente`" passa a incluir `caminhoDoPdfDoConteudo(…, { doPlano: true })` — exceção ao "só acrescentar", avisada à orquestradora)
- Modify: `docs/manual-tecnico/04-modulos-clinicos.md` (§4.3, §4.4, §4.6), `05-agenda-portal-conteudo.md`, `02-banco-de-dados.md`, `06-worker-seguranca-operacao.md` (§6.8.1: parágrafo **"Voltar atrás depois do Plano 19"** — a imagem anterior mostra todas as refeições todo dia e soma os dois "Almoço" no total; o plano em texto livre aparece vazio; "Editar" perde `dias_semana`, `descricao_livre`, listas e conteúdos ligados; publicar na imagem antiga um rascunho com `referencia_id` cai em 23514 (`meal_plans_referencia_so_rascunho`); jobs `plano-pdf-2` ficam esperando o worker novo; **depois do seed da USDA (Tarefa 12), não voltar abaixo do PR do código: corrigir para a frente**, porque a imagem anterior rotula a USDA como "TACO" e congela `origem: 'TACO'`), `README.md` (glossário e divergências; nota de que o SET NULL de `plano_conteudos.content_id` ao excluir um conteúdo grava "alterar Plano alimentar" no Histórico de cada paciente com o conteúdo ligado, inclusive em plano publicado — aceito, como a RN-238 registrou para o perfil), pelo agente **`guardiao-manual`**; specs do MVP (RN-01, RN-02, RN-12, RN-13, INT-04 com versão nova; os textos novos da RN-259 na tabela "Textos de interface" das histórias do MVP) e da IA (nota da RN-116/RN-126); backlog PD-20 a PD-28 (carga da TBCA e seed da USDA pendentes); manual do usuário (Docs) e Central de Ajuda **preparados** para o dono publicar
- Test: o próprio E2E

- [ ] **Step 1: E2E que falha:** nutricionista monta um plano com "Almoço" seg–sex e "Almoço" sáb–dom (nomes acessíveis da Tarefa 7), liga a lista "Trocas do dia a dia {sufixo}" e a orientação "Como montar o prato" (fora da audiência), publica (passa pelo "Publicar mesmo assim" se houver aviso); paciente abre `/p/plano` e vê o dia certo, a lista inline e a orientação, abre o PDF da orientação; no feed de Conteúdos a orientação não aparece. Axe com zero violação nas rotas novas (`ROTAS_DO_PAINEL`) e nos estados do laço. **RNF-230**: medir no E2E o tempo de digitação num plano com 50 refeições e registrar.
- [ ] **Step 2:** `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/plano-alimentar-2.spec.ts e2e/acessibilidade-painel.spec.ts e2e/acessibilidade.spec.ts` → FAIL (com o horário combinado com a orquestradora).
- [ ] **Step 3:** ajustes que o E2E pedir; manuais pelo `guardiao-manual`; registrar no fechamento as versões de guia que subiram (avisam "O manual foi atualizado"), as edições no lugar em arquivos disputados e, se o 18 PR 2 não estava na `main`, a contagem "No app" como tarefa da sessão do 18 (usando a mesma projeção de `planoDoPaciente`: o paciente lê o `titulo` de `plano_conteudos` mesmo com o conteúdo despublicado, RN-240, então a contagem nunca usa a RLS do paciente sozinha).
- [ ] **Step 4:** `pnpm test && pnpm lint && pnpm typecheck` + o E2E acima → PASS; `pnpm test:tempo` com a CPU liberada (spec §16); a pilha de carga (P08-03, `test/carga/`) com um plano de 50 refeições (RN-249), no horário que a orquestradora der, com o número registrado no fechamento.
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 19 (P19-11)`.

---

### Task 12: Seed da USDA — PR seguinte, depois do deploy do PR do código (D29)

Só começa com o PR do código **em produção** (o código que lê `foods.fonte` precisa estar no ar antes da primeira linha `usda`). Branch nova a partir da `main` (`plano-19-seed-usda`), na mesma sessão B. **Deploy sozinho**, sem outro PR no mesmo trem (a migration é longa no boot). Depois do deploy deste PR, a volta atrás nunca vai abaixo do PR do código (§6.8.1, Tarefa 11).

**Files:**
- Create: `scripts/usda/preparar-seed.ts` (lê os CSVs do FoodData Central — Foundation e SR Legacy de uma versão fixa — baixados uma vez para fora do repositório; filtra categorias de marca/restaurante e nomes com palavra de 3+ letras em caixa alta; converte unidades pelo mapa; energia "Energy (kcal)" → Atwater específica → geral → nulo; grava `seeds/usda-alimentos.csv`, `seeds/usda-nomes-pt.csv`, `seeds/usda-nutrientes.csv`, `seeds/usda-grupos.csv`, `seeds/usda-exclusoes.csv` com o motivo), `scripts/seeds/gerar-usda.ts` (`pnpm seed:usda`, molde de `gerar-medidas.ts`: gera o SQL da migration custom `seed_usda` com `ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY` … INSERTs … `CREATE INDEX foods_busca_original_idx ON foods USING gin (app_unaccent(lower(nome_original)) gin_trgm_ops) WHERE nome_original IS NOT NULL` **depois** dos INSERTs … `FORCE`; dividida em partes se passar de 10 MB)
- Modify: `src/modules/alimentos/fontes.ts` (`FONTES.usda.versao`, ano e `sha256` dos arquivos de origem), `package.json` (`seed:usda`), `src/app/painel/configuracoes/page.tsx` (cartão "Alimentos": "TACO, USDA e os seus alimentos."), `src/modules/ajuda/conteudo.ts` (resumo de `alimentos` e `configuracoes` com a USDA; `versao + 1`), `src/db/migrate-owner.test.ts` (contagem `usda` > 0 com o migrator sem superusuário), `src/modules/alimentos/foods-rls.test.ts` (a contagem de `fonte = 'taco'` continua 597; a de `tenant_id is null` passa a TACO + USDA)
- Tradução (PM-PA4): o agente que executa traduz `usda-nomes-pt.csv` em lotes (2 a 120 caracteres); o `normas-cfn-lgpd` revisa por amostragem (marcas, termos clínicos) e o relatório de exclusões.
- Test: `src/modules/alimentos/usda-fonte.test.ts` (molde de `taco-fonte.test.ts`), `src/modules/alimentos/busca.tempo.test.ts`, `src/db/migrate-owner.test.ts`, `src/modules/alimentos/foods-rls.test.ts`

- [ ] **Step 1: Testes que falham** (`usda-fonte.test.ts`): sha256 dos arquivos de origem (pulado com mensagem clara se os arquivos não estiverem na máquina; o CSV versionado é refeito e comparado quando estão); nenhum nome importado com palavra em caixa alta de 3+ letras; toda chave de `micros` no catálogo e toda unidade do mapa casando; nenhuma linha fora das faixas do CHECK; todo grupo entre os 15; tradução de 2 a 120 caracteres; nenhuma linha `tbca` (a guarda da RN-232 já está em `fontes.test.ts` desde a Tarefa 2 e passa a cobrir o seed novo). `busca.tempo.test.ts`: p95 ≤ 300 ms por nome e ≤ 500 ms por nutriente e equivalentes com o seed (CS-231).
- [ ] **Step 2:** `pnpm vitest run src/modules/alimentos/usda-fonte.test.ts src/db/migrate-owner.test.ts` → FAIL.
- [ ] **Step 3:** preparar o seed, traduzir, `pnpm seed:usda`, migration custom, `pnpm db:migrate` no `nutri_dev_b`; **medir a duração da migration** e o aumento do `pnpm test` (o Testcontainers migra do zero a cada execução) e registrar no PR (RNF-231); avisar as outras sessões, pela orquestradora, de que o `pnpm test` e o CI ficam mais lentos.
- [ ] **Step 4:** mesmo comando + `VITEST_SO_TEMPO=1 pnpm vitest run src/modules/alimentos/busca.tempo.test.ts` (com CPU liberada) + `CI=1 pnpm test src/modules/alimentos` → PASS.
- [ ] **Step 5:** commit `feat(alimentos): seed da USDA FoodData Central (Foundation e SR Legacy) (P19-12)`; manual técnico §4.3 e Central de Ajuda com a USDA carregada (guardiao-manual).

---

## Revisores por tarefa

| Tarefa | `revisor-rls` | `normas-cfn-lgpd` | `revisor-interface` | `guardiao-manual` |
|---|---|---|---|---|
| 1 Banco | ✔ | ✔ (prontuário, minimização) | | |
| 2 Regras puras | | ✔ (citações, catálogo) | | |
| 3 Fontes | ✔ (busca, IA) | ✔ (marca, citação, D8) | ✔ | |
| 4 Publicação | ✔ | ✔ (Res. 594 art. 4º § 1º VIII, avisos) | ✔ | |
| 7 Editor | | ✔ (texto livre, VET) | ✔ | |
| 5 Perfis | ✔ | ✔ (fonte obrigatória, nada pré-carregado) | ✔ | |
| 6 Diálogo | | ✔ (critério, "Sugestão: confira") | ✔ | |
| 8 Biblioteca | ✔ | ✔ (observação, LGPD art. 6º III) | ✔ | |
| 9 Ligado ao plano | ✔ | ✔ (RN-12) | ✔ | |
| 10a App do paciente | ✔ | ✔ (CS-232) | ✔ | |
| 10b PDF | ✔ (fila nova) | ✔ (citação, micros) | ✔ | |
| 10c IA | ✔ | ✔ (IA Nutri, D26) | | |
| 10d Exportação e lembretes | ✔ | ✔ (exportação) | ✔ (ajuda do portal) | |
| 11 Fechamento | | | ✔ | ✔ |
| 12 Seed USDA | ✔ (NO FORCE, migrator) | ✔ (marcas, tradução, citação) | | ✔ |

## Migrations antes do PR (`sessoes-paralelas.md` §5)

Antes de abrir o PR do código (e de novo se outro PR com migration entrar na `main` antes):

1. `git fetch origin`; listar as migrations do branch (`git diff --name-only --diff-filter=A origin/main...HEAD -- drizzle/`) e guardá-las em `../migrations-b/`, anotando a ordem (gerada com o preenchimento editado à mão → as oito `rls_<tabela>` na ordem da Tarefa 1 → `plano19_fks_dias_conteudos`).
2. (Atalho) commit que volta `drizzle/` ao merge-base; `git rebase origin/main`; conflito no schema = juntar as duas mudanças.
3. Remover os SQL, snapshots e o journal do branch (`git diff origin/main -- drizzle/` vazio).
4. `pnpm db:generate` e **reaplicar a edição à mão** do preenchimento de `foods` (bloco NO FORCE/UPDATE/FORCE antes dos CHECKs; procurar o comentário `-- Plano 19 (editado à mão)`). Se não der para encaixar, regenerar por etapas.
5. Recriar as nove custom na ordem original e colar o SQL guardado; conferir regras 2 e 8.
6. Encadeamento (`_journal.json`, `prevId`, `pnpm drizzle-kit check`); `grep -rn "<número antigo>" src test docs CLAUDE.md`.
7. Com OK do dono (é apagar, mesmo em dev): parar `next dev` e worker da sessão, `dropdb nutri_dev_b`, `scripts/sessao-paralela.sh b plano-19-plano-alimentar-2` (recria e migra do zero).
8. `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/plano19-banco.test.ts src/db/migrate-owner.test.ts src/db/migrate.test.ts` (o `migrate.test.ts` traz a guarda do `when` do `_journal.json` do Plano 20, se já estiver na `main`) e a suíte toda antes do push.

Só um PR com migration na fila por vez. O PR do seed (Tarefa 12) refaz os passos 1 a 8 sobre a `main` com o PR do código já mesclado.

## Coordenação com as outras sessões (para a orquestradora)

- **Ordem de merge combinada:** 17 → (20 PR 1) → 18 PR 2 → 19 código → … → 19 seed por último e sozinho. Se o 19 ficar pronto antes do 18 PR 2, a contagem "No app" passa ao 18.
- **Lembretes:** se o 17 não entrar antes do 19, o 17 leva o filtro por dia antes do merge dele.
- **Blocos de IP de E2E:** distribuir entre 17, 18, 19 e 20.
- **Edições no lugar em arquivos disputados:** `rls-guard.ts` (`CONTEUDO_POR_AUDIENCIA.contents`, `AUDIENCIA_EXIGE.contents`), guia `plano-alimentar` (passos no meio) e `CLAUDE.md` regra 2 (chamadores de `liberarReceitasDoPlano`); o 18 (Tarefa 9, Passo 4) aceita o terceiro chamador.
- **Guias:** dois aumentos de versão do guia do portal (17 e 19) em deploys próximos, se o dono preferir evitar, o 17 tem a alternativa de não subir.
- **`e2e/portal.ts` e `e2e/plano-alimentar.spec.ts`:** o "Publicar" do 19 mantém o `confirm` e só acrescenta "Publicar mesmo assim" quando há aviso; os helpers do 17 e do 18 continuam valendo.

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (o do código e, depois, o do seed): revisão final do branch (workflow, com `revisor-rls`, `normas-cfn-lgpd`, `revisor-interface` e `guardiao-manual`) → uma onda de correções → `/code-review high` no PR **uma vez** → correções Critical/Important (Minor vai para o backlog) → re-revisão **só do diff das correções** → `/security-review` (checklist reforçado: RLS da biblioteca e das ligações, RN-12 ampliada e o PDF com `?de=plano`, CS-232) → **portão da IA Nutri** (PM-PA15): nova avaliação da RN-184 pelo dono, com casos de lista de substituição, texto livre e dias (`docs/operacao/ia.md`) → merge **só com o OK do dono** (merge = deploy; a migration roda no boot do `nutri_app`; avisar do risco do snapshot com a produção no ar). A orquestradora escalona as revisões pesadas com as outras sessões e atualiza o painel do backlog Paridade Dietbox.

## Decisões da orquestradora (16/11/2026, com autorização do dono para seguir as recomendações)

- **Trem de merge da onda 1:** 17 → 18 PR 1 → 20 PR 1 → 19 (código) → 18 PR 2 → 20 PR 2 → 20 PR 3 → 19 (seed, sozinho). O Plano 17 entra primeiro; o filtro por dia dos lembretes fica com este plano (T10a), como está escrito.
- **"No app":** quem entrar depois faz a contagem. Como o 19 (código) entra antes do 18 PR 2, a contagem de materiais e da lista de substituição fica com a sessão do Plano 18.
- **Faixa de IP do E2E:** cada plano usa a própria faixa (sufixo = número do plano). Antes, confira em `e2e/` como os IPs são gerados.
