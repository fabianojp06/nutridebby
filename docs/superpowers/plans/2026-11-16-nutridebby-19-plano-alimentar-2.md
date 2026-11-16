# Plano 19 — Plano alimentar 2 (Paridade Dietbox, onda 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o editor de plano alimentar ganha a USDA (e o lugar da TBCA), micronutrientes com perfis de referência, busca por nutriente e por equivalentes, texto livre por refeição, dias da semana por refeição, minhas refeições, listas de substituição e receitas/materiais ligados ao plano; o app do paciente passa a mostrar o dia certo e o que está ligado ao plano publicado.

**Architecture:** tudo como extensão de `foods`, `meal_plans`, `meals` e `meal_items` (RN-01 intacta: um publicado, um rascunho, publicado congelado), mais seis tabelas `staff_only` da biblioteca do consultório (`src/db/schema/biblioteca-plano.ts`) e duas ligações com `patient_id` (`plano_listas_substituicao`, `plano_conteudos`) auditadas e com `paciente_sem_rascunho`. Regras puras em `src/modules/plano-alimentar/dias.ts`, `src/modules/alimentos/{fontes,nutrientes}.ts` e `calculo.ts`. A exceção da RN-12 é ampliada na política de `contents`, com o mesmo marcador. O seed da USDA entra **num PR seguinte**, depois do deploy do código (spec D29).

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, actions e componentes cliente) · Drizzle · PostgreSQL 16 (RLS, pg_trgm) · pg-boss · `@react-pdf/renderer` (só no worker) · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-nutridebby-19-plano-alimentar-2-design.md` (v0.2, decisões aprovadas pelo dono em 16/11/2026; revisão das quatro lentes no §18).

## Global Constraints

- **Ambiente da sessão B.** Worktree `../nutridebby-b`, branch `plano-19-plano-alimentar-2`, porta **3102**, banco **`nutri_dev_b`**. Preparo e reparo: `scripts/sessao-paralela.sh b plano-19-plano-alimentar-2` (script do PR #50, branch `docs/sessoes-paralelas`; enquanto não mesclado, rodar a cópia daquele branch). Dev: `pnpm exec next dev -p 3102`. E2E: `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e …` (a `APP_URL` só no comando, nunca exportada; pare o `pnpm worker` da sessão antes; **um E2E por vez entre as sessões**). Antes de qualquer comando de banco: `env | cut -d= -f1 | grep -E '^(DATABASE_URL|APP_URL|DATA_DIR)'` vazio. Suíte inteira (`pnpm test`, E2E) só quando a orquestradora liberar (limite de 3 sessões, `sessoes-paralelas.md` §2); por tarefa, rode só os testes listados.
- **Nunca produção.** Nenhum subagente consulta o banco de produção, nem para ler. MCP `postgres-dev` aponta para o banco do principal, não para o da sessão: use `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_b`. Não faça push sem o controlador; merge só com OK do dono (merge = deploy; a migration roda no boot).
- **Migrations** (`sessoes-paralelas.md` §5): **nenhum número é reservado**. Gere com `pnpm db:generate` / `pnpm drizzle-kit generate --custom --name <nome>` sobre o que estiver no branch; antes do PR, a migration é **gerada de novo** sobre a `main` (procedimento no fim deste plano). Toda edição à mão numa migration gerada leva um comentário `-- Plano 19 (editado à mão): …` para o passo 1 do §5 achar. Rodar sempre com `DATABASE_URL_MIGRATOR` (regra 7).
- **Arquivos disputados** (`sessoes-paralelas.md` §6): `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `src/db/schema/index.ts`, `e2e/painel-rotas.ts`, `src/modules/ajuda/{conteudo,portal}.ts`, `docs/manual-tecnico/`, o índice dos planos e o backlog: **só acrescentar** no fim do bloco certo; nada de reordenar ou reformatar.
- **Expansão, nunca contração.** A imagem antiga roda durante o boot do app novo e na volta atrás: coluna nova sempre com default que a imagem antiga satisfaça (`foods.fonte DEFAULT 'propria'` permanente, spec I-2); nenhuma coluna removida ou renomeada; nenhuma linha da USDA neste PR (D29).
- **`foods` tem FORCE RLS e o migrator é `NOBYPASSRLS`.** Escrita de dados em `foods` numa migration só no molde da `drizzle/0042_seed_medidas_ibge.sql` (`ALTER TABLE foods NO FORCE ROW LEVEL SECURITY` … `FORCE`). **Proibido** criar política de escrita em `foods` para `tenant_id` nulo.
- Regras 1, 2, 3, 8 e 9 do `CLAUDE.md`: `withTenant`, RLS + guardas, nada de nome de alimento, texto livre, observação ou valor de nutriente em log/Sentry, `audit_log` pelo gatilho e `auditRead` ao devolver dado de saúde, `FABRICAS`.
- `calculo.ts` continua puro (sem banco nem React). `lerCongelados` é o único leitor de `meal_items.nutrientes`.
- Micronutrientes e perfil **nunca** nas telas, no payload RSC nem na cópia offline do app (CS-232); o PDF marcado e a exportação do titular os mantêm.
- Textos de interface em pt-BR, exatos da spec (§5, §6.1). Rotas do portal mantêm `?v=` do vínculo (`telaDoPortal`). Componentes base V2, alvos `min-h-11`, erros ao lado do campo com `role="alert"` e `aria-describedby`.
- Limites: 50 refeições e 400 itens no editor; 15 refeições e 200 itens em todo o caminho da IA (`MAX_*_RASCUNHO_IA`); 12 nutrientes exibidos; 5 listas e 10 conteúdos por plano; minha refeição até 40 itens (200 por consultório); lista até 20 grupos × 30 itens (100 por consultório).

## Review Focus

1. **Imagem antiga e migration** — a migration aplica com o migrator sem superusuário (`migrate-owner.test.ts`), o preenchimento de `foods` fica certo (contagem por `fonte`) e um INSERT de `foods` sem `fonte` (o da imagem antiga) continua válido. Tarefa 1.
2. **RLS da biblioteca e das ligações** — as seis tabelas da biblioteca são `staff_only` (paciente, inclusive `semConta`, lê zero linhas); lista e conteúdo ligados só ao rascunho não aparecem ao paciente; o conteúdo fora da audiência só abre (texto e PDF) pelo caminho do plano e nunca conta "Quem viu". Tarefas 1 e 9.
3. **Dia da semana e fuso** — virada domingo 23:59 → segunda 00:00 no fuso do consultório (`America/Manaus`), cópia offline aberta no dia seguinte, "Comi assim" de outro dia recusado, total do dia por perfil (nunca a soma de dois "Almoço"). Tarefas 2 e 10.
4. **Congelação** — plano publicado antes do deploy abre sem erro (formato antigo); publicado novo congela fonte, versão, `fonteOrigem`, micros e perfil; a publicação zera `referencia_id`; excluir perfil não toca publicado nem gera `audit_log` nele. Tarefas 4 e 5.
5. **IA** — as ferramentas da IA da nutricionista nunca devolvem USDA; o rascunho da IA fica em 15/200; a IA Nutri cita `#S` antes de `#L`, recebe texto livre mascarado, nunca micros nem perfil, com nova `PROMPT_VERSAO_CONVERSA`. Tarefas 3, 4 e 10.

---

## Ordem e fundação

`[1] → [2] → [3 ‖ 4] → [5 ‖ 6 ‖ 7] → [8] → [9] → [10] → [11]` no PR do código; **[12] no PR seguinte**, depois do deploy do PR do código (D29).

- **Fundação (Tarefas 1 e 2)** é o que as outras sessões usam: `meals.dias_semana` e `src/modules/plano-alimentar/dias.ts` (`DiaDaSemana`, `ORDEM_DIAS`, `DIA_CURTO`, `rotuloDosDias`, `rotuloDosDiasPorExtenso`, `valeNoDia`) — o Plano 17 passa a importar dali no rebase (D28) — e as tabelas `plano_conteudos`/`plano_listas_substituicao`, que a contagem "No app" do Plano 18 vai ler. Se a orquestradora pedir, as Tarefas 1 e 2 saem num **PR de fundação** pequeno, mergeado antes (`sessoes-paralelas.md` §7); as outras sessões fazem rebase em cima dele. Sem esse pedido, seguem no PR do código.
- **Lembretes (D28):** a parte dos lembretes da Tarefa 10 só entra se o Plano 17 já estiver na `main` no momento do rebase; senão fica registrada no fechamento (Tarefa 11) como pendência de quem entrar depois.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/db/schema/alimentos.ts` (modificar) | `fonte`, `fonte_ref`, `nome_original`, CHECKs, índice de grupo |
| `src/db/schema/plano-alimentar.ts` (modificar) | Colunas novas de `meal_plans` e `meals`; `plano_listas_substituicao`, `plano_conteudos` |
| `src/db/schema/biblioteca-plano.ts` (novo) | `referencias_nutrientes`, `refeicoes_modelo`, `refeicoes_modelo_itens`, `listas_substituicao`, `listas_substituicao_grupos`, `listas_substituicao_itens` |
| `drizzle/NNNN_*.sql` (gerada + custom `rls_biblioteca_plano`, `rls_plano_ligados`, `plano19_fks_dias_conteudos`) | Colunas, tabelas, RLS, auditoria, FKs `SET NULL`, `app_dias_semana_validos`, política de `contents` |
| `src/modules/plano-alimentar/dias.ts` (novo) | Dias da semana, perfis de dia, rótulos, dia no fuso |
| `src/modules/alimentos/fontes.ts` (novo) | `FONTES`, `TBCA_AUTORIZADA`, selo, sigla, citação, "Sem valor na …" |
| `src/modules/alimentos/nutrientes.ts` (novo) | Catálogo `NUTRIENTES` e formatação |
| `src/modules/plano-alimentar/congelados.ts` (novo) | `lerCongelados` (formato antigo e novo) |
| `src/modules/alimentos/{busca,alimentos,alimentos-constantes,taco}.ts` (modificar) | Filtro de fonte, ordem, nome original, micros do "Meu alimento", textos por fonte |
| `src/modules/alimentos/referencias.ts` (novo) | Perfis de referência |
| `src/modules/alimentos/busca-avancada.ts` (novo) | Busca por nutriente e equivalentes |
| `src/modules/plano-alimentar/{refeicoes-modelo,listas,ligados}.ts` (novos) | Biblioteca e ligações |
| `src/modules/plano-alimentar/{calculo,constantes,tipos,carregar,rascunho,publicacao,modelos,plano-pdf,plano-pdf-job}.ts(x)` (modificar) | Micros, modo, dias, cópias, avisos, PDF |
| `src/app/painel/planos/editor/*` (modificar) + `dialogo-busca.tsx`, `nutrientes-do-paciente.tsx`, `ligado-ao-plano.tsx`, `filtro-dias.tsx` (novos) | Editor |
| `src/app/painel/planos/{refeicoes,listas,referencias}/**` (novos) | Telas da biblioteca |
| `src/app/painel/alimentos/**`, `src/app/api/painel/alimentos/**` (modificar/novo) | Selo, micros, filtros, equivalentes |
| `src/modules/portal/{plano,mural,diario,diario-constantes,lista-compras,conteudos}.ts`, `src/app/p/(portal)/{plano,inicio,compras}/**`, `src/app/api/p/conteudos/[id]/pdf/route.ts` (modificar) | App do paciente |
| `src/modules/ia/{ferramentas-alimentos,plano-ia,rascunho-ia,rascunho-dados}.ts`, `src/modules/ia/nutri-paciente/{contexto,instrucoes,validar-resposta,montar-resposta,textos}.ts` (modificar) | IA |
| `src/modules/pacientes/exportacao-job.ts` (modificar) | Exportação |
| `scripts/usda/preparar-seed.ts`, `scripts/seeds/gerar-usda.ts`, `seeds/usda-*.csv` (Tarefa 12) | Seed USDA |
| `src/modules/ajuda/{conteudo,portal}.ts` (modificar) | Guia `biblioteca-do-plano` e versões |

---

### Task 1: Banco — colunas, tabelas, RLS, auditoria e guardas (fundação)

**Files:**
- Modify: `src/db/schema/alimentos.ts` — `fonte: text('fonte').notNull().default('propria')` (default **permanente**, comentário citando a spec I-2), `fonteRef: text('fonte_ref')`, `nomeOriginal: text('nome_original')`; CHECKs `foods_fonte_valida`, `foods_fonte_ref_tamanho` (1–40), `foods_nome_original_valido`; `foods_origem_valida` refeito (`(tenant_id is null) = (fonte <> 'propria') and (fonte = 'propria') = (fonte_ref is null) and (taco_id is not null) = (fonte = 'taco')`); `foods_valores_faixa` com kcal até 1000; UNIQUE `foods_fonte_ref_unique (fonte, fonte_ref)`; índice `foods_grupo_idx`. O índice de trigramas de `nome_original` **não** entra aqui (vai na Tarefa 12, depois do INSERT).
- Modify: `src/db/schema/plano-alimentar.ts` — `meal_plans`: `modo` (default `'calculado'`, CHECK), `referenciaId`, `nutrientesExibidos` (`text[]`, default `'{}'`, CHECK ≤ 12), `referenciaCongelada` (jsonb, CHECK `is null or status <> 'rascunho'`), `macrosPrescritos` (jsonb, CHECK `is null or modo = 'livre'`), `mostrarMicrosPdf` (default false), CHECK `meal_plans_referencia_so_rascunho` (`referencia_id is null or status = 'rascunho'`); `meals`: `diasSemana` (`smallint[]`, default `'{0,1,2,3,4,5,6}'`; o CHECK com a função vai na custom), `descricaoLivre` (CHECK ≤ 2000); tabelas `plano_listas_substituicao` e `plano_conteudos` (spec §9.2; `conteudo` com CHECK `octet_length(conteudo::text) <= 65536`; índice `(tenant_id, content_id) where content_id is not null`).
- Create: `src/db/schema/biblioteca-plano.ts` (as seis tabelas da spec §9.2; `referencias_nutrientes` com `UNIQUE (tenant_id, id)`; FKs compostas com cascade; `food_id` RESTRICT); export em `src/db/schema/index.ts` (só acrescentar).
- Create: migration gerada (`pnpm db:generate`) **editada à mão**: entre o `ADD COLUMN` de `foods` e o `ADD CONSTRAINT` dos CHECKs novos de `foods`, o bloco `ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY;` → `UPDATE "foods" SET "fonte" = 'taco', "fonte_ref" = "taco_id"::text WHERE "tenant_id" IS NULL;` → `ALTER TABLE "foods" FORCE ROW LEVEL SECURITY;`, com comentário `-- Plano 19 (editado à mão): …`. Se o `drizzle-kit` gerar o CHECK antes do preenchimento de um jeito que a edição não resolva, regenere por etapas (§5, passo 4).
- Create: custom `rls_biblioteca_plano` — para as seis: `app_enable_tenant_rls` + `app_enable_staff_only`. Custom `rls_plano_ligados` — para as duas: `app_enable_tenant_rls` + `app_enable_patient_rls` + política RESTRICTIVE `paciente_sem_rascunho` (molde da 0045, `EXISTS` em `meal_plans` com `status <> 'rascunho'`) + `app_enable_audit('<tabela>', 'plano_alimentar')`. Custom `plano19_fks_dias_conteudos` — função `app_dias_semana_validos(smallint[])` `IMMUTABLE` (1–7 valores, 0–6, ordem crescente, sem repetição, `array_position(d, NULL) IS NULL`) e CHECK `meals_dias_validos`; FKs `ON DELETE SET NULL (referencia_id)` e `SET NULL (content_id)` (molde da 0082); `DROP`/`CREATE` de `paciente_conteudo_visivel` com o ramo novo da RN-253 dentro do mesmo `current_setting('app.receitas_do_plano', true) = 'on'`.
- Modify: `src/db/rls-guard.ts` — `STAFF_ONLY` com as seis tabelas (motivo `'Plano 19: biblioteca do consultório; o paciente nunca vê'`, e `'… perfil de referência'` na primeira); `CONTEUDO_POR_AUDIENCIA.contents` ganha o fragmento do ramo novo (`fromplano_conteudos`), conferido por `findConteudoAudienciaViolations`.
- Modify: `test/isolamento.test.ts` — `FABRICAS` das oito tabelas; `COM_MAE` com as filhas (`refeicoes_modelo_itens`, `listas_substituicao_grupos`, `listas_substituicao_itens`, `plano_listas_substituicao`, `plano_conteudos`; fábrica cria a mãe no mesmo comando por CTE). **Sem** filtro em `SO_APAGA.patients` (única FK é para `meal_plans`). Conferir `ULTIMAS` (mães com cascade não precisam; `foods` já está).
- Modify: `src/db/migrate-owner.test.ts` — caso novo com o migrator sem superusuário.
- Test: `src/db/plano19-banco.test.ts` (novo).

**Interfaces:**
- Produces: `foods.fonte/fonteRef/nomeOriginal`, `mealPlans.{modo,referenciaId,nutrientesExibidos,referenciaCongelada,macrosPrescritos,mostrarMicrosPdf}`, `meals.{diasSemana,descricaoLivre}`, `referenciasNutrientes`, `refeicoesModelo`, `refeicoesModeloItens`, `listasSubstituicao`, `listasSubstituicaoGrupos`, `listasSubstituicaoItens`, `planoListasSubstituicao`, `planoConteudos` e os tipos `*Row`.

- [ ] **Step 1: Testes que falham.** `plano19-banco.test.ts`:
  - `foods sem fonte continua válido` — INSERT pela sessão `nutri` com `tenant_id` e sem `fonte` grava `propria` (a imagem antiga).
  - `CHECK de origem` — `fonte = 'usda'` com `tenant_id` preenchido, `propria` com `fonte_ref`, `taco_id` com `fonte <> 'taco'` → violação; kcal 950 passa, 1001 recusa.
  - `nenhuma política de escrita em tenant_id nulo` — INSERT/UPDATE de `foods` com `tenant_id` nulo pela sessão `nutri` → 42501 (consulta `pg_policies`: nenhuma política de `foods` além de `tenant_isolation`, `taco_leitura` e as do `app_enable_tenant_rls`).
  - `dias_semana` — `{1,2,3,4,5}` passa; `{}`, `{7}`, `{3,1}`, `{1,1}` e `{1,NULL}` → violação.
  - `staff_only da biblioteca` — sessão de paciente (com conta e `semConta`) lê zero linhas das seis tabelas, mesmo com linhas no tenant.
  - `ligado ao rascunho não vaza` — `plano_listas_substituicao` e `plano_conteudos` de um rascunho: paciente lê 0; do publicado: lê 1.
  - `RN-12 ampliada` — conteúdo `orientacao` fora da audiência, ligado ao publicado: com `liberarReceitasDoPlano(tx)` o paciente lê; sem, não; ligado só ao rascunho, não lê nem com a liberação; `paciente_conteudo_visto` continua recusando o INSERT com o marcador ligado.
  - `referencia_id só no rascunho` — `UPDATE meal_plans SET status = 'publicado'` com `referencia_id` preenchido → violação; excluir o perfil anula `referencia_id` do rascunho e não grava `audit_log` em nenhum plano publicado.
  - `auditoria` — INSERT em `plano_listas_substituicao` e `plano_conteudos` pela `nutri` grava `audit_log` com entidade `plano_alimentar`; nas seis da biblioteca, nenhum.
  - `migrate-owner.test.ts`: depois de migrar com o migrator `NOSUPERUSER NOBYPASSRLS`, `select fonte, count(*) from foods group by fonte` dá só `taco` (as linhas da TACO, mesma contagem de `taco_id is not null`) e nenhuma `usda`/`tbca`; `relforcerowsecurity` de `foods` continua `true`.
- [ ] **Step 2:** `pnpm vitest run src/db/plano19-banco.test.ts src/db/migrate-owner.test.ts` → FAIL.
- [ ] **Step 3:** schema, `pnpm db:generate`, edição à mão, migrations custom, `pnpm db:migrate` no `nutri_dev_b`.
- [ ] **Step 4:** `pnpm vitest run src/db/plano19-banco.test.ts src/db/migrate-owner.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/modules/alimentos/foods-rls.test.ts src/modules/alimentos/taco-fonte.test.ts` → PASS. `pnpm drizzle-kit check` sem erro.
- [ ] **Step 5:** commit `feat(plano19): banco — fontes, dias, biblioteca e ligações com RLS e auditoria (P19-01)`.

**Pronto quando:** as guardas acusam a falta de qualquer uma das oito tabelas; `migrate-owner` passa sem superusuário; nenhuma linha `usda`/`tbca` existe.

---

### Task 2: Regras puras — dias, fontes, catálogo, micros e congelados (fundação)

**Files:**
- Create: `src/modules/plano-alimentar/dias.ts`, `src/modules/alimentos/fontes.ts`, `src/modules/alimentos/nutrientes.ts`, `src/modules/plano-alimentar/congelados.ts`
- Modify: `src/modules/plano-alimentar/calculo.ts` (`microsDoItem`, `totalMicros`, totais por dia), `src/modules/plano-alimentar/tipos.ts` e `src/db/schema/plano-alimentar.ts` (tipo `NutrientesCongelados` com `fonte`, `fonteVersao`, `fonteOrigem`, `micros`; `origem` fica), `src/modules/alimentos/taco.ts` (`FONTE_TACO_TEXTO` reexportado de `FONTES.taco`; `CAMPOS_MICRO` passa a vir do catálogo)
- Test: `dias.test.ts`, `fontes.test.ts`, `nutrientes.test.ts`, `congelados.test.ts`, `calculo.test.ts` (casos novos)

**Interfaces:**
- Produces:
```ts
// dias.ts — D28: único lugar de DiaDaSemana; o Plano 17 importa daqui no rebase
export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo
export const ORDEM_DIAS: readonly DiaDaSemana[]; // [1,2,3,4,5,6,0] — seg…dom
export const DIA_CURTO: Record<DiaDaSemana, string>; // 'seg' … 'dom'
export const DIA_EXTENSO: Record<DiaDaSemana, string>; // 'Segunda' … 'Domingo'
export const TODOS_OS_DIAS: readonly DiaDaSemana[]; // [0..6]
export function rotuloDosDias(d: readonly DiaDaSemana[]): string;          // 'todos os dias' | 'seg a sex' | 'sáb e dom' | 'seg, qua e sex'
export function rotuloDosDiasPorExtenso(d: readonly DiaDaSemana[]): string; // 'Todos os dias' | 'Segunda a sexta' | 'Sábado e domingo' | 'Segunda, quarta e sexta'
export function diaDaSemanaNoFuso(agora: Date, fuso: string): DiaDaSemana;
export function valeNoDia(r: { diasSemana: readonly number[] }, dia: DiaDaSemana): boolean;
export type PerfilDeDia<R> = { dias: DiaDaSemana[]; refeicoes: R[] };
export function perfisDeDia<R extends { id: string; diasSemana: readonly number[] }>(refeicoes: R[]): PerfilDeDia<R>[]; // dias sem refeição ficam fora; ordem seg…dom
export function diasSemRefeicao(refeicoes: { diasSemana: readonly number[] }[]): DiaDaSemana[];
// fontes.ts
export type Fonte = 'taco' | 'usda' | 'tbca' | 'propria';
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
export function microsDoItem(i: { quantidadeG: number; micros: Partial<Record<ChaveNutriente, number | null>> }): Partial<Record<ChaveNutriente, number>>;
export function totalMicros(refeicoes: …, chaves: ChaveNutriente[]): Record<ChaveNutriente, { total: number; semValor: number }>; // só itens principais
// congelados.ts
export function lerCongelados(n: unknown): { nome: string; fonte: Fonte; fonteVersao: string | null; fonteOrigem: Fonte | null; kcal: number | null; proteinaG: …; micros: … | null };
```
- `lerCongelados`, formato antigo (sem `fonte`): `'TACO'` → `taco`, `'Meu alimento'` → `propria`, `micros: null`. Correto só porque nenhuma linha da USDA existe enquanto a imagem antiga pode publicar (D29) — comentário no código.
- `FONTES.usda.citacao`: `U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, {ano}. fdc.nal.usda.gov` (o ano e o sha256 são preenchidos na Tarefa 12; até lá, `FONTES.usda` existe mas nenhuma tela a mostra, porque não há linha `usda`). `FONTES.tbca.citacao` com o texto completo da RN-232 ("… Disponível em: http://www.fcf.usp.br/tbca. Acesso em: {data}.").

- [ ] **Step 1: Testes que falham.** `dias.test.ts`: os quatro formatos de cada rótulo; ordem seg…dom (`rotuloDosDias([0,6])` → `sáb e dom`, `rotuloDosDiasPorExtenso([0,6])` → `Sábado e domingo`); `perfisDeDia` com "Almoço" seg–sex e "Almoço" sáb–dom → 2 perfis; todas as refeições nos 7 dias → 1 perfil; **Review Focus 3** `diaDaSemanaNoFuso(new Date('2026-11-16T03:59:00Z'), 'America/Manaus')` → 0 (domingo 23:59 local) e `…T04:00:00Z` → 1. `nutrientes.test.ts`: 31 chaves únicas, as 20 da TACO presentes, `microsValidos({ sodio_mg: -3 })` e chave fora do catálogo recusados. `fontes.test.ts`: `fontesVisiveis(['taco','usda','tbca','propria'])` sem `tbca`; `semValorNa('usda')` → `Sem valor na USDA`. `congelados.test.ts`: formato antigo e novo. `calculo.test.ts`: `totalMicros` ignora substituições, conta `semValor`, soma por dia.
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar/dias.test.ts src/modules/alimentos/fontes.test.ts src/modules/alimentos/nutrientes.test.ts src/modules/plano-alimentar/congelados.test.ts src/modules/plano-alimentar/calculo.test.ts` → FAIL.
- [ ] **Step 3:** implementar (datas no fuso com o helper de `src/modules/agenda/fuso.ts`).
- [ ] **Step 4:** mesmo comando + `src/modules/alimentos/taco.test.ts` → PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit `feat(plano19): dias da semana, fontes, catálogo de nutrientes e congelados (P19-02)`.

**Pronto quando:** `calculo.ts` continua sem import de banco ou React (teste de grafo existente verde) e todo leitor futuro tem `lerCongelados` para usar.

---

### Task 3: Fontes nos alimentos, nas receitas e na IA da nutricionista; micros no "Meu alimento"

**Files:**
- Modify: `src/modules/alimentos/busca.ts` (`buscarAlimentos(ctx, termo, db, o?: { fontes?: Fonte[]; grupo?: string })`; procura em `nome` e `nome_original`; ordem: começa com a 1ª palavra → fonte brasileira ou própria antes da USDA → semelhança → nome mais curto; `AlimentoEncontrado` ganha `fonte`, `nomeOriginal`, `micros`), `src/modules/alimentos/alimentos.ts` (micros opcionais no cadastro e na edição, validados por `microsValidos`; "Duplicar" copia `micros` e `origem_food_id`; `exigirProprio` sem mudança), `src/modules/alimentos/alimentos-constantes.ts` (`KCAL_MAX = 1000`; `MSG_ALIMENTO.valores` com 1000; `taco`, `incompleto` e `emUso` com os textos da RN-230/RN-258), `src/modules/plano-alimentar/constantes.ts` (`MSG_PLANO.semValor` por fonte)
- Modify: `src/app/painel/alimentos/busca-alimento.tsx` (`Selo` por `Fonte`, `kcalTexto` por fonte, nome original em texto menor e o aviso "Nome traduzido automaticamente do inglês." visível no resultado da USDA), `src/app/painel/alimentos/[id]/page.tsx` (`valor()` por fonte; citação da fonte do alimento; aviso de tradução), `src/app/painel/alimentos/page.tsx` (fontes carregadas listadas), `src/app/painel/alimentos/alimento-form.tsx` (seção recolhida "Micronutrientes (opcional)", um campo por chave do catálogo, erro "Use um número de 0 a 100000." no campo)
- Modify: `src/modules/conteudo/receitas.ts` (linha ~123: `origem` de `foods.fonte` via `seloDaFonte`), `src/app/painel/conteudos/[id]/receita-form.tsx` (selo e "Sem valor na …" por fonte), a página da receita no portal se mostrar o selo
- Modify: `src/modules/ia/ferramentas-alimentos.ts` (`buscaDoTenant` passa `fontes: ['taco', 'propria']`), `src/modules/ia/rascunho-ia.ts` (~136: `origem` de `foods.fonte`)
- Modify: `src/modules/ajuda/conteudo.ts` — guia `alimentos` 1 → 2 (resumo sem "A tabela TACO": "As tabelas públicas de composição (TACO) e os alimentos que você cadastrar ("Meu alimento"), com as medidas caseiras."; a USDA entra no resumo só na Tarefa 12, quando houver linhas)
- Test: `src/modules/alimentos/busca.test.ts`, `alimentos.test.ts`, `src/modules/conteudo/receitas.test.ts`, `src/modules/ia/ferramentas-alimentos.test.ts`, `src/app/api/painel/alimentos/route.test.ts`, `src/modules/ajuda/conteudo.test.ts`

- [ ] **Step 1: Testes que falham** (com linhas `usda` inseridas pela fábrica do teste no molde NO FORCE, só no Testcontainers):
  - busca: "quinoa" traz o próprio e a TACO antes da USDA; "cooked quinoa" acha pelo `nome_original`; `fontes: ['usda']` só USDA; `tbca` nunca aparece.
  - **Review Focus 5** `ferramentas da IA nunca devolvem USDA` — `buscaDoTenant` com um alimento USDA que casa o termo → ausente.
  - receita com ingrediente USDA → selo `USDA (EUA)`; `rascunho-ia` com alimento USDA (não deve vir da ferramenta, mas se vier pelo id) → origem pela fonte.
  - "Meu alimento" com `calcio_mg: 120` salva; `sodio_mg: -3` → `{ 'micros.sodio_mg': 'Use um número de 0 a 100000.' }`; chave fora do catálogo recusada; kcal 950 salva (KCAL_MAX 1000).
  - "Duplicar" de alimento USDA: `micros` copiados, `origem_food_id` preenchido, aviso `MSG_ALIMENTO.incompleto` com "A USDA não tem todos os valores…".
  - textos: nenhum `'Sem valor na TACO'` literal fora de `fontes.ts` (teste de grep em `src/`, exceto testes).
  - `conteudo.test.ts`: guia `alimentos` na versão 2.
- [ ] **Step 2:** `pnpm vitest run src/modules/alimentos src/modules/conteudo/receitas.test.ts src/modules/ia/ferramentas-alimentos.test.ts src/app/api/painel/alimentos src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(alimentos): fonte do alimento na busca, nas receitas e na IA; micros do meu alimento (P19-03)`.

**Pronto quando:** nenhum código decide a fonte por `tenant_id` (grep de `tenantId === null ? 'TACO'` vazio) e a IA só recebe TACO e próprios.

---

### Task 4: Publicação, cópias do plano, limites e avisos em dois passos

**Files:**
- Modify: `src/modules/plano-alimentar/publicacao.ts` (`publicarPlano`: congela `fonte`, `fonteVersao`, `fonteOrigem`, `micros` no `UPDATE … FROM foods`, fonte de `foods.fonte`; grava `referencia_congelada = { id, nome, fonte, valores }` e zera `referencia_id`; devolve `{ avisos }` sem publicar quando há aviso e `confirmarAvisos` não veio — sem VET no modo livre, dias sem refeição; `editarPublicado` copia o cabeçalho novo e o perfil de `referencia_congelada.id` se ele ainda for visível), `src/modules/plano-alimentar/modelos.ts` (`salvarComoModelo`, `criarDeModelo`: cabeçalho novo), `src/modules/plano-alimentar/rascunho.ts` (`copiarConteudo`: `dias_semana`, `descricao_livre`, `plano_listas_substituicao`, `plano_conteudos`; `validar`/`iguais`/`exigirPublicavel` com modo, dias, texto e `macros_prescritos`; mensagem "A refeição "{nome}" está sem texto." com a chave do campo), `src/modules/plano-alimentar/constantes.ts` (`MAX_REFEICOES = 50`, `MAX_ITENS = 400`, `MAX_REFEICOES_RASCUNHO_IA = 15`, `MAX_ITENS_RASCUNHO_IA = 200`, `MSG_PLANO.limite`, `MSG_PLANO.limiteRascunhoIa`, `MSG_TEXTO_LIVRE`, `MSG_DIAS`)
- Modify: `src/modules/ia/rascunho-dados.ts` (43–44), `src/modules/ia/plano-ia.ts` (104, 125), `src/modules/ia/ferramentas-alimentos.ts` (76–77), `src/app/painel/pacientes/[id]/plano-alimentar/rascunho-ia/metas-form.tsx` (6, 117, 122) — constantes e mensagem do rascunho da IA; `rascunho-ia.ts` ("Usar como rascunho": `modo = 'calculado'`, 7 dias)
- Modify: `src/app/painel/pacientes/[id]/plano-alimentar/actions.ts` e `[planId]/page.tsx` — o botão "Publicar" deixa o `confirmar` fixo do `BotaoAcao`: a action devolve `{ avisos: string[] }`; a tela mostra os avisos em `role="alert"` junto do botão e o botão "Publicar mesmo assim" (D31); o erro de campo é link âncora que leva o foco ao campo. `src/app/painel/planos/salvar-como-modelo.tsx`: aviso "Observações e textos das refeições vão para o modelo. Retire dados do paciente antes de salvar."
- Test: `publicacao.test.ts`, `modelos.test.ts`, `rascunho.test.ts`, `src/modules/ia/{rascunho-dados,plano-ia,ferramentas-alimentos}.test.ts`, `src/app/painel/pacientes/[id]/plano-alimentar/actions.test.ts`

- [ ] **Step 1: Testes que falham:**
  - **Review Focus 4** `plano publicado antes do deploy` — linha com `nutrientes` no formato antigo: `carregarPlano` e o PDF leem sem erro; `lerCongelados` dá `taco`/`propria`.
  - publicar congela `fonte`, `fonteVersao`, `micros` e `referencia_congelada`; `referencia_id` do publicado é nulo; editar o perfil depois não muda o publicado.
  - `Editar` num publicado em texto livre → rascunho `modo = 'livre'` com os textos, `dias_semana` e `macros_prescritos`; com o perfil ainda existente, `referencia_id` = `referencia_congelada.id`; excluído → nulo.
  - `salvarComoModelo`/`criarDeModelo` copiam modo, dias, texto, listas e conteúdos ligados (cópia, sem reler a biblioteca).
  - avisos: modo livre sem `meta_kcal` → `{ avisos: ['Registre o VET, a distribuição de macro e micronutrientes e as quantidades da prescrição no plano ou no atendimento.'] }` e nada publicado; com `confirmarAvisos` publica; domingo sem refeição → `Domingo não tem refeições.`; sábado e domingo → `Sábado e domingo não têm refeições.`.
  - refeição livre sem texto → erro com o texto exato; `macros_prescritos` que não somam 100 → `A soma de proteína, carboidrato e lipídio precisa dar 100%.`.
  - limites: 50 refeições salvam, 51 recusam com `O plano pode ter até 50 refeições e 400 itens.`; rascunho da IA com 16 refeições → `O rascunho da IA pode ter até 15 refeições e 200 itens.`; saída da IA com 16 refeições → `null` em `plano-ia.ts`.
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar src/modules/ia/rascunho-dados.test.ts src/modules/ia/plano-ia.test.ts src/modules/ia/ferramentas-alimentos.test.ts "src/app/painel/pacientes/[id]/plano-alimentar/actions.test.ts"` → FAIL.
- [ ] **Step 3:** implementar (ordem de travas de sempre: paciente → tenant → plano).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): publicação com fonte e micros, cópias completas, limites e avisos em dois passos (P19-04)`.

---

### Task 5: Perfis de referência e "Nutrientes do paciente"

**Files:**
- Create: `src/modules/alimentos/referencias.ts` (`listarReferencias`, `salvarReferencia`, `excluirReferencia`; nome 1–80 único, fonte 2–300 obrigatória, valores por chave com `meta`/`maximo`, ao menos um nutriente, `meta ≤ maximo`), `src/app/painel/planos/referencias/page.tsx`, `.../referencias/[id]/page.tsx`, `.../referencias/actions.ts`, `.../referencias/referencia-form.tsx`
- Create: `src/app/painel/planos/editor/nutrientes-do-paciente.tsx` (perfil, até 12 nutrientes, linhas "Ferro: 12,4 mg · meta 18 mg (69%)", "Acima do máximo (2300 mg)" em texto, "{n} itens sem valor de {nutriente}", "Ver todos os nutrientes", caixa "Mostrar no PDF os nutrientes escolhidos" desabilitada com "Ligue antes "Mostrar calorias ao paciente"."; some no modo livre)
- Modify: `src/app/painel/planos/editor/{editor-plano,estado,painel-totais}.tsx/ts`, `src/modules/plano-alimentar/{carregar,rascunho}.ts` (salvar `referencia_id`, `nutrientes_exibidos`, `mostrar_micros_pdf`; leitura com `referencia_congelada` no publicado), `src/app/painel/configuracoes/page.tsx` (cartão "Perfis de referência" no fim de `CARTOES`)
- Modify: `src/modules/ajuda/conteudo.ts` — guia novo `biblioteca-do-plano` (versão 1, `padrao: /^\/painel\/planos\/(refeicoes|listas|referencias)(\/.*)?$/`, resumo e passos sem alvo, como `modelos`; o passo de perfis diz que a plataforma não traz valores prontos); `e2e/painel-rotas.ts` (`/painel/planos/referencias` e `[id]`)
- Test: `src/modules/alimentos/referencias.test.ts`, `.../referencias/actions.test.ts`, `src/app/painel/planos/editor/estado.test.ts`, `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/rotas-axe.test.ts`

- [ ] **Step 1: Testes que falham:** salvar sem fonte → `Informe a fonte dos valores (ex.: DRI/IOM 2006, IN 75/2020 da ANVISA).`; sem valor → `Informe a meta ou o máximo de pelo menos um nutriente.`; nome repetido recusado; outro tenant não vê (RLS); lista vazia mostra o texto exato da US-232; a confirmação de excluir tem o texto exato da spec e, depois, o rascunho fica "Sem perfil" e o publicado não muda; 13º nutriente → `Escolha até 12 nutrientes.`; o resumo do editor por dia (com o filtro da Tarefa 7, usa `totalMicros` do dia); guia `biblioteca-do-plano` casa as rotas novas.
- [ ] **Step 2:** `pnpm vitest run src/modules/alimentos/referencias.test.ts src/app/painel/planos src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): perfis de referência e nutrientes do paciente (P19-05)`.

---

### Task 6: Diálogo "Buscar alimento" — Lista, Nutrientes e Equivalentes

**Files:**
- Create: `src/modules/alimentos/busca-avancada.ts` (`buscarPorNutriente(ctx, { chave, direcao, grupo?, fontes? })` — só com valor, até 20, desempate por nome; `equivalentes(ctx, { foodId, quantidadeG, igualarPor, fontes? })` — mesmo grupo, valor > 0, quantidade `ref × v_ref ÷ v_cand` arredondada a 1 g entre 0,1 e 5000; por energia ordena pela soma das diferenças de P/C/L; por nutriente filtra energia ±10% e ordena pela diferença de energia; até 20; devolve o texto do critério), `src/app/api/painel/alimentos/equivalentes/route.ts`, `src/app/painel/planos/editor/dialogo-busca.tsx` (`<dialog>` nativo, `aria-labelledby`, abas com `tablist`/`tab`/`tabpanel` e setas, foco no campo ao abrir e volta ao botão que abriu, contagem em `role="status"`, "Adicionado a {refeição}." em `role="status"`, diálogo aberto para vários itens, aba Equivalentes desabilitada sem item com o texto da spec, "Ver nutrientes" sem sair do diálogo, link "Não encontrou? Cadastrar meu alimento (abre em outra aba)" com `rel="noopener"`)
- Modify: `src/app/api/painel/alimentos/route.ts` (parâmetros `fonte`, `grupo`, `nutriente`, `direcao`), `src/app/painel/planos/editor/editor-plano.tsx` (botão "Mais opções de busca" **dentro de cada refeição**, com a refeição como destino; ação "Equivalentes de {item}" em cada item, cujo escolhido entra como substituição com a quantidade sugerida)
- Test: `src/modules/alimentos/busca-avancada.test.ts`, `src/app/api/painel/alimentos/route.test.ts`, `.../equivalentes/route.test.ts`, `src/app/painel/planos/editor/estado.test.ts`; `busca.tempo.test.ts` ganha por nutriente e equivalentes com a TACO (o volume da USDA é medido na Tarefa 12)

- [ ] **Step 1: Testes que falham:** "Rico em ferro" ordena do maior ao menor e exclui nulos; "Pobre em sódio" com grupo; equivalentes do arroz 120 g por energia dão o macarrão com a quantidade da fórmula; por carboidrato só os de energia ±10%; critério exato ("Mesmo grupo (Cereais e derivados) · mesma energia · ordenados pela proximidade de proteína, carboidrato e lipídio."); vazio → `Nenhum alimento atende a este critério.`; alimento próprio de outro tenant nunca aparece; `estado.test.ts`: "Adicionar como substituição" cria o item com `substituiItemId` do item de referência.
- [ ] **Step 2:** `pnpm vitest run src/modules/alimentos/busca-avancada.test.ts src/app/api/painel/alimentos src/app/painel/planos/editor` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS; `VITEST_SO_TEMPO=1 pnpm vitest run src/modules/alimentos/busca.tempo.test.ts` só quando a orquestradora liberar CPU.
- [ ] **Step 5:** commit `feat(plano): diálogo de busca com nutrientes e equivalentes (P19-06)`.

---

### Task 7: Editor — texto livre e dias da semana

**Files:**
- Create: `src/app/painel/planos/editor/filtro-dias.tsx` (grupo de botões com `aria-pressed`: "Todos", "seg" … "dom"; legenda "seg a sex: 1.820 kcal · sáb e dom: 2.050 kcal" e "{dia}: sem refeições"; em "Todos" com perfis diferentes, a tabela dos perfis e "Escolha um dia para ver os detalhes.")
- Modify: `src/app/painel/planos/editor/{editor-plano.tsx,estado.ts,painel-totais.tsx,navegacao.ts}` — seletor "Como montar o plano" ("Com alimentos e quantidades" / "Texto livre por refeição") com os `confirm` da troca (RN-245, dentro do editor); caixa "O que comer" (`descricao_livre`); "Meta (kcal)" e "Distribuição prescrita (opcional)"; caixas "Dias de {refeição}" (`<fieldset>`, `min-h-11`); cartão com `rotuloDosDias`; totais, meta e nutrientes **por dia**; "Aparece para o paciente no app." (`aria-describedby`) na observação e no texto livre; nomes acessíveis com os dias quando o nome da refeição se repete ("Horário de Almoço (seg a sex)"); no modo livre somem "Mostrar calorias ao paciente" e "Nutrientes do paciente"
- Modify: `src/modules/plano-alimentar/rascunho.ts` (troca de modo pelo salvamento de sempre: calculado → livre gera o texto da RN-245 cortado em 2000; livre → calculado apaga texto e `macros_prescritos`), `src/modules/ajuda/conteudo.ts` (guia `plano-alimentar`: passos `modo-plano` e `dias-refeicao` com `data-guia`; `versao + 1` sobre o que estiver na `main` — o Plano 17 também sobe; atualizar o `toBe` da linha 111 de `conteudo.test.ts`)
- Test: `estado.test.ts`, `navegacao.test.ts`, `rascunho.test.ts`, `src/modules/ajuda/conteudo.test.ts`

- [ ] **Step 1: Testes que falham:** troca calculado → livre gera `Arroz branco, cozido — 4 colheres de sopa; Feijão… (ou …)`; livre → calculado limpa texto e macros; banco nunca grava `descricao_livre` com itens no calculado (RN-243); filtro "sáb" mostra só as refeições de sábado e os totais de sábado; legenda com "dom: sem refeições"; nomes acessíveis únicos com dois "Almoço"; **PM-PA9** medição com 50 refeições e 400 itens: recálculo síncrono de `estado.ts` abaixo de 16 ms por tecla no Vitest (registrar o número no commit).
- [ ] **Step 2:** `pnpm vitest run src/app/painel/planos/editor src/modules/plano-alimentar/rascunho.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): texto livre por refeição e dias da semana no editor (P19-07)`.

---

### Task 8: Biblioteca — minhas refeições e listas de substituição

**Files:**
- Create: `src/modules/plano-alimentar/refeicoes-modelo.ts` (salvar do editor sem observação por padrão; "Incluir a observação"; carregar no rascunho com ids novos, 7 dias, horário salvo, valores atuais; no plano livre os itens viram texto pela regra da RN-245; até 40 itens e 200 por consultório), `src/modules/plano-alimentar/listas.ts` (CRUD; nome único; orientação ≤ 1000; 20 grupos × 30 itens; 100 listas; energia calculada na hora); as duas conferem que cada `food_id` é **visível** na sessão antes de gravar (molde de `rascunho.ts:202-205`, RN-258)
- Create: `src/app/painel/planos/refeicoes/{page.tsx,[id]/page.tsx,actions.ts,refeicao-form.tsx}`, `src/app/painel/planos/listas/{page.tsx,[id]/page.tsx,actions.ts,lista-form.tsx}` ("Sugerir equivalentes" abre o diálogo da Tarefa 6 com o primeiro item do grupo)
- Modify: `src/app/painel/planos/editor/editor-plano.tsx` ("Salvar como minha refeição" com o aviso "Confira o nome e os itens: retire dados do paciente antes de salvar." e, ao marcar a observação, "A observação pode ter dados do paciente. Revise antes de salvar."; "Carregar minha refeição"), `src/app/painel/configuracoes/page.tsx` (cartões "Minhas refeições" e "Listas de substituição"; cartão "Alimentos" com "TACO, USDA e os seus alimentos." só na Tarefa 12), `src/modules/alimentos/alimentos-constantes.ts` (`MSG_ALIMENTO.emUso` da RN-258), `src/modules/ajuda/conteudo.ts` (passos de `biblioteca-do-plano`; `configuracoes` 8 → 9 com o resumo citando a biblioteca, ajustar o `toBe(8)` da linha 123), `e2e/painel-rotas.ts` (4 rotas)
- Test: `refeicoes-modelo.test.ts`, `listas.test.ts`, `.../refeicoes/actions.test.ts`, `.../listas/actions.test.ts`, `src/modules/alimentos/alimentos.test.ts` (alimento em uso numa lista → mensagem nova), `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/rotas-axe.test.ts`

- [ ] **Step 1: Testes que falham:** salvar sem observação por padrão e com ela quando marcada; carregar dá ids novos, 7 dias e horário; num plano livre entra como texto; 41º item, 21º grupo (`A lista pode ter até 20 grupos e 30 itens por grupo.`) e 31º item recusados; `food_id` de alimento próprio de outro tenant → erro de campo, nada gravado; excluir alimento usado numa minha refeição ou lista → `Este alimento está em uso (plano, receita, minha refeição ou lista de substituição) e não pode ser excluído.`; paciente lê zero linhas (reaproveita a guarda da Tarefa 1).
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar/refeicoes-modelo.test.ts src/modules/plano-alimentar/listas.test.ts src/app/painel/planos src/modules/alimentos/alimentos.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): minhas refeições e listas de substituição (P19-08)`.

---

### Task 9: Ligado ao plano — lista, receitas e materiais; RN-12 ampliada

**Files:**
- Create: `src/modules/plano-alimentar/ligados.ts` (`ligarLista` grava a cópia com `fonteOrigem` por item; `atualizarDaBiblioteca` só no rascunho, "A lista de origem foi excluída." quando sumiu; `removerLista`; `ligarConteudo`/`desligarConteudo` com título copiado; até 5 listas e 10 conteúdos, `O plano pode ter até 5 listas e 10 receitas ou materiais.`), `src/app/painel/planos/editor/ligado-ao-plano.tsx` ("Cópia de {data}. Mudanças na biblioteca não alteram este plano.", "Não publicado — o paciente não vê", "{título} (excluído)")
- Modify: `src/modules/conteudo/audiencia.ts` (só o comentário: "conteúdos do plano"), `src/modules/portal/conteudos.ts` (`caminhoDoPdfDoConteudo(ctx, id, db, o?: { doPlano?: boolean })` chama `liberarReceitasDoPlano(tx)` só com `doPlano`), `src/app/api/p/conteudos/[id]/pdf/route.ts` (`?de=plano` → `doPlano: true`), `src/app/p/(portal)/conteudos/[id]/page.tsx` (`?de=plano` já existe para receita; vale para todo tipo ligado), `src/modules/plano-alimentar/carregar.ts` (`PlanoCompleto` ganha `listas` e `conteudos`, sem mudar assinaturas usadas pelo 17)
- Modify: `src/modules/portal/conteudos.test.ts` — guarda (linhas 160–178): em `conteudos.ts`, **duas** chamadas, uma em `conteudoDoPaciente` e outra em `caminhoDoPdfDoConteudo`; em `plano.ts`, uma em `planoDoPaciente`; feed, busca, favoritos, visualização e `conteudosNovosNaTransacao` nunca ligam.
- Test: `ligados.test.ts`, `src/modules/portal/conteudos.test.ts`, `src/app/api/p/conteudos/[id]/pdf/route.test.ts`

- [ ] **Step 1: Testes que falham:** a cópia não muda quando a lista da biblioteca é editada; "Atualizar da biblioteca" troca a cópia só no rascunho; **Review Focus 2** orientação fora da audiência ligada ao publicado abre pelo plano (texto e PDF com `?de=plano`) e não abre pelo feed, pela busca, pelos favoritos; abrir pelo plano não grava em `content_views`; ligada só ao rascunho não abre nem com `?de=plano`; despublicada some do app e fica "Não publicado — o paciente não vê" no editor; excluída fica `content_id` nulo com o título.
- [ ] **Step 2:** `pnpm vitest run src/modules/plano-alimentar/ligados.test.ts src/modules/portal/conteudos.test.ts "src/app/api/p/conteudos"` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `src/db/rls-guard.test.ts test/isolamento.test.ts` + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(plano): lista de substituição, receitas e materiais ligados ao plano (P19-09)`.

---

### Task 10: Leitores do plano publicado — app, lista de compras, PDF, IA Nutri, exportação e lembretes

Checklist fechado (RN-247, PM-PA8): editor (Tarefa 7), mural, página Plano, próxima refeição, "Comi assim", `versaoDaCopiaOffline`, lista de compras, PDF, contexto da IA Nutri, resumo da IA da nutricionista, exportação, lembretes (se o 17 estiver na `main`). Leitores do **total do dia**: editor, PDF, Plano, mural, IA Nutri.

**Files:**
- Modify: `src/modules/portal/plano.ts` (`planoDoPaciente` com projeção **fechada**: dias, `descricaoLivre`, perfis com total por dia, `listas` inline, `conteudos` só publicados; `proximaRefeicao` com dias e texto "Próxima: amanhã às {hh:mm}" / "Próxima: {dia} às {hh:mm}"; `versaoDaCopiaOffline` com id, título e situação dos conteúdos ligados e o hash das listas), `src/modules/portal/mural.ts` (só as refeições de hoje; vazio do dia "Seu plano não tem refeições para hoje."), `src/modules/portal/diario.ts` + `diario-constantes.ts` (`refeicaoDoPlanoPublicado` só aceita refeição que vale hoje; `MSG_DIARIO.refeicaoDeOutroDia = 'Esta refeição não é de hoje.'`), `src/modules/portal/lista-compras.ts` (por dia da janela; texto livre fora com os dois avisos da RN-248)
- Modify: `src/app/p/(portal)/plano/page.tsx` + componente cliente novo `dia-de-hoje.tsx` (recebe os 7 dias e o fuso; marca "Hoje ({dia})" com o relógio do aparelho; "Ver outros dias" `min-h-11`; seção "Ligado ao seu plano" com "Lista de substituição" inline e "Receitas e materiais do seu plano" com "Abrir precisa de internet."; textos de usuário com `whitespace-pre-line wrap-break-word`), `refeicao-detalhe.tsx` (`valeHoje`: fora do dia esconde as três ações e mostra "Você responde a esta refeição no dia dela."; texto livre como "Sua nutricionista:", sem kcal), `src/app/p/(portal)/plano/refeicao/[id]/page.tsx` (outro dia = só leitura), `src/app/p/(portal)/inicio/page.tsx`, `src/app/p/(portal)/compras/page.tsx`
- Modify: `src/modules/plano-alimentar/plano-pdf.tsx` + `plano-pdf-job.ts` (um bloco por perfil com `rotuloDosDiasPorExtenso` e total do dia; "{n} refeições por dia" por perfil; texto livre, meta e distribuição; nutrientes escolhidos e referência só com `mostrar_micros_pdf` e `mostrar_calorias`; "Lista de substituição" no fim; conteúdos ligados **publicados** no fim; rodapé "Fontes:" com as fontes usadas, inclusive `fonteOrigem` e listas, e "Nomes de alimentos da USDA traduzidos do inglês." quando houver item da USDA)
- Modify: `src/modules/ia/nutri-paciente/contexto.ts` (dias de cada refeição e o dia de hoje; trecho `#R` do modo livre = `descricao_livre` mascarada; lista como `#L{lista}-{grupo}`, tipo `lista_substituicao`, fonte "Lista de substituição — {grupo}", mascarada; `relerTrechos` relê a cópia do publicado; kcal do dia do perfil de hoje), `instrucoes.ts` (`SISTEMA_CONVERSA` com `#L` e "substituição: #S ou #L"; **nova `PROMPT_VERSAO_CONVERSA`**), `validar-resposta.ts` (`PREFIXOS.substituicao = ['#S', '#L']`), `montar-resposta.ts` (ordena `#S` antes de `#L`); `src/modules/ia/resumo-dados.ts` (D26: refeição livre vai sem itens e sem o texto; nada novo sai)
- Modify: `src/modules/pacientes/exportacao-job.ts` (`planosParaExportacao`: campos da RN-257; no `titular`, conteúdo ligado só se existir e estiver publicado; atualizar os literais de `DadosExportacao` em `exportacao.test.ts`)
- Modify (só se o Plano 17 estiver na `main`): `src/modules/lembretes/slots.ts` (`RefeicaoDoPlano` ganha `dias`; `planoDoDia` pula a refeição fora do dia), `envio.ts` e `equipe.ts` (leitura traz `dias_semana`), import de `DiaDaSemana` de `dias.ts`
- Modify: `src/modules/ajuda/portal.ts` (página Plano com dias; "Ligado ao seu plano" com a ressalva "quando a sua nutricionista ligar"; `versao + 1` sobre a `main`; ajustar `portal.test.ts`)
- Test: `src/modules/portal/{plano,mural,diario,lista-compras}.test.ts`, `src/app/p/(portal)/plano/page.test.ts`, `src/modules/plano-alimentar/plano-pdf-job.test.ts`, `src/modules/ia/nutri-paciente/{contexto,instrucoes,validar-resposta,montar-resposta}.test.ts`, `src/modules/ia/resumo.test.ts` (o que `resumo-dados.ts` manda), `src/modules/pacientes/exportacao.test.ts`, `src/modules/ajuda/portal.test.ts`, `src/modules/lembretes/slots.test.ts` (se aplicável)

- [ ] **Step 1: Testes que falham:**
  - **CS-232** chaves fechadas de `planoDoPaciente`, do mural e da lista de compras (molde de `documentos.test.ts`); nenhum valor de micro nem nome de perfil no `JSON.stringify` da resposta; `plano_conteudos.titulo` de conteúdo despublicado ausente.
  - **CS-233 / Review Focus 3** `America/Manaus`, domingo 23:59 local → mural e Plano com as de domingo; segunda 00:00 → as de segunda; "Comi assim" de refeição de sábado num domingo → `Esta refeição não é de hoje.`, nada gravado; próxima depois da última de sábado sem refeição no domingo → "Próxima: seg às 07:30".
  - total do dia com dois "Almoço" (seg–sex 600 kcal, sáb–dom 800 kcal) num sábado → só o de 800 entra.
  - `versaoDaCopiaOffline` muda ao despublicar um conteúdo ligado e ao atualizar a lista.
  - lista de compras de 7 dias a partir de uma quarta soma o almoço de seg–sex 3 vezes (qua, qui, sex) + 2 da semana seguinte (seg, ter).
  - PDF: dois perfis com título e total; rodapé com TACO e USDA quando houver; sem micros sem as duas caixas; conteúdo despublicado fora.
  - IA Nutri: contexto com dias e "hoje"; lista mascarada com `#L`; `validarSaida` aceita `#L` em `substituicao`; **Review Focus 5** `montarResposta` com fontes `['#L1-1', '#S2']` cita `#S2` primeiro; nenhum micro no contexto; `PROMPT_VERSAO_CONVERSA` diferente da `conversa-2026-10-14`.
  - exportação: `titular` sem conteúdo excluído nem despublicado; `equipe` com "{título} (excluído)"; micros e `referencia` presentes nos dois escopos.
- [ ] **Step 2:** `pnpm vitest run src/modules/portal "src/app/p/(portal)/plano" src/modules/plano-alimentar/plano-pdf-job.test.ts src/modules/ia src/modules/pacientes/exportacao.test.ts src/modules/ajuda/portal.test.ts` → FAIL.
- [ ] **Step 3:** implementar; **PM-PA9**: medir o PDF e o tamanho do contexto da IA Nutri com 50 refeições e 400 itens e registrar no commit (se o contexto passar do orçamento de tokens da IA Nutri definido no Plano 15, parar e avisar o controlador: o limite volta a ser discutido, R-239).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(portal): dia da semana, ligado ao plano, PDF, IA Nutri e exportação (P19-10)`.

---

### Task 11: Fechamento do PR do código — E2E, acessibilidade, manuais e ajuda

**Files:**
- Create: `e2e/plano-alimentar-2.spec.ts` (bloco de IP novo, comentado no cabeçalho)
- Modify: `e2e/acessibilidade-painel.spec.ts` (no laço claro/escuro/aparelho: diálogo aberto em cada aba, editor com filtro de dia, aviso de publicação), `e2e/acessibilidade.spec.ts` (`/p/plano` com dois perfis, lista e conteúdos ligados; 320 px com fonte a 200% e texto livre com link longo), `scripts/e2e-seed.ts` e `test/carga/seed.ts` (acréscimos: plano com seg–sex e sáb–dom, lista e orientação ligadas)
- Modify: `CLAUDE.md` (regras 1, 2 e 8: frase do Plano 19 no fim — seis tabelas `staff_only`, as duas ligações auditadas com `paciente_sem_rascunho`, a RN-12 ampliada com `caminhoDoPdfDoConteudo(…, { doPlano: true })`, proibição de política de escrita em `foods` com `tenant_id` nulo)
- Modify: `docs/manual-tecnico/04-modulos-clinicos.md` (§4.3, §4.4, §4.6), `05-agenda-portal-conteudo.md`, `02-banco-de-dados.md`, `README.md` (glossário e divergências), pelo agente **`guardiao-manual`**; specs do MVP (RN-01, RN-02, RN-12, RN-13, INT-04 com versão nova) e da IA (nota da RN-116/RN-126); backlog PD-20 a PD-28 (carga da TBCA e seed da USDA pendentes); manual do usuário (Docs) e Central de Ajuda **preparados** para o dono publicar
- Test: o próprio E2E

- [ ] **Step 1: E2E que falha:** nutricionista monta um plano com "Almoço" seg–sex e "Almoço" sáb–dom (nomes acessíveis da Tarefa 7), liga a lista "Trocas do dia a dia" e a orientação "Como montar o prato" (fora da audiência), publica (passa pelo "Publicar mesmo assim" se houver aviso); paciente abre `/p/plano` e vê o dia certo, a lista inline e a orientação, abre o PDF da orientação; no feed de Conteúdos a orientação não aparece. Axe com zero violação nas rotas novas (`ROTAS_DO_PAINEL`) e nos estados do laço.
- [ ] **Step 2:** `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/plano-alimentar-2.spec.ts e2e/acessibilidade-painel.spec.ts e2e/acessibilidade.spec.ts` → FAIL (com o horário combinado com a orquestradora).
- [ ] **Step 3:** ajustes que o E2E pedir; manuais pelo `guardiao-manual`; registrar no fechamento as versões de guia que subiram (avisam "O manual foi atualizado") e a pendência dos lembretes, se o 17 não estava na `main`.
- [ ] **Step 4:** `pnpm test && pnpm lint && pnpm typecheck` + o E2E acima → PASS.
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 19 (P19-11)`.

---

### Task 12: Seed da USDA — PR seguinte, depois do deploy do PR do código (D29)

Só começa com o PR do código **em produção** (o código que lê `foods.fonte` precisa estar no ar antes da primeira linha `usda`). Branch nova a partir da `main` (`plano-19-seed-usda`), na mesma sessão B.

**Files:**
- Create: `scripts/usda/preparar-seed.ts` (lê os CSVs do FoodData Central — Foundation e SR Legacy de uma versão fixa — baixados uma vez para fora do repositório; filtra categorias de marca/restaurante e nomes com palavra de 3+ letras em caixa alta; converte unidades pelo mapa; energia "Energy (kcal)" → Atwater específica → geral → nulo; grava `seeds/usda-alimentos.csv`, `seeds/usda-nomes-pt.csv`, `seeds/usda-nutrientes.csv`, `seeds/usda-grupos.csv`, `seeds/usda-exclusoes.csv` com o motivo), `scripts/seeds/gerar-usda.ts` (`pnpm seed:usda`, molde de `gerar-medidas.ts`: gera o SQL da migration custom `seed_usda` com `ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY` … INSERTs … `CREATE INDEX foods_busca_original_idx ON foods USING gin (app_unaccent(lower(nome_original)) gin_trgm_ops) WHERE nome_original IS NOT NULL` **depois** dos INSERTs … `FORCE`; dividida em partes se passar de 10 MB)
- Modify: `src/modules/alimentos/fontes.ts` (`FONTES.usda.versao`, ano e `sha256` dos arquivos de origem), `package.json` (`seed:usda`), `src/app/painel/configuracoes/page.tsx` (cartão "Alimentos": "TACO, USDA e os seus alimentos."), `src/modules/ajuda/conteudo.ts` (resumo de `alimentos` e `configuracoes` com a USDA; `versao + 1`), `src/db/migrate-owner.test.ts` (contagem `usda` > 0 com o migrator sem superusuário)
- Tradução (PM-PA4): o agente que executa traduz `usda-nomes-pt.csv` em lotes (2 a 120 caracteres); o `normas-cfn-lgpd` revisa por amostragem (marcas, termos clínicos) e o relatório de exclusões.
- Test: `src/modules/alimentos/usda-fonte.test.ts` (molde de `taco-fonte.test.ts`), `src/modules/alimentos/busca.tempo.test.ts`, `src/db/migrate-owner.test.ts`

- [ ] **Step 1: Testes que falham** (`usda-fonte.test.ts`): sha256 dos arquivos de origem (pulado com mensagem clara se os arquivos não estiverem na máquina; o CSV versionado é refeito e comparado quando estão); nenhum nome importado com palavra em caixa alta de 3+ letras; toda chave de `micros` no catálogo e toda unidade do mapa casando; nenhuma linha fora das faixas do CHECK; todo grupo entre os 15; tradução de 2 a 120 caracteres; nenhuma linha `tbca` (guarda da RN-232: falha se qualquer migration ou seed inserir `tbca` com `TBCA_AUTORIZADA` false — `grep` em `drizzle/*.sql` e `seeds/`). `busca.tempo.test.ts`: p95 ≤ 300 ms por nome e ≤ 500 ms por nutriente e equivalentes com o seed (CS-231).
- [ ] **Step 2:** `pnpm vitest run src/modules/alimentos/usda-fonte.test.ts src/db/migrate-owner.test.ts` → FAIL.
- [ ] **Step 3:** preparar o seed, traduzir, `pnpm seed:usda`, migration custom, `pnpm db:migrate` no `nutri_dev_b`; **medir a duração da migration** e registrar no PR (RNF-231).
- [ ] **Step 4:** mesmo comando + `VITEST_SO_TEMPO=1 pnpm vitest run src/modules/alimentos/busca.tempo.test.ts` (com CPU liberada) + `pnpm test src/modules/alimentos` → PASS.
- [ ] **Step 5:** commit `feat(alimentos): seed da USDA FoodData Central (Foundation e SR Legacy) (P19-12)`; manual técnico §4.3 e Central de Ajuda com a USDA carregada (guardiao-manual).

---

## Revisores por tarefa

| Tarefa | `revisor-rls` | `normas-cfn-lgpd` | `revisor-interface` | `guardiao-manual` |
|---|---|---|---|---|
| 1 Banco | ✔ | ✔ (prontuário, minimização) | | |
| 2 Regras puras | | ✔ (citações, catálogo) | | |
| 3 Fontes | ✔ (busca, IA) | ✔ (marca, citação, D8) | ✔ | |
| 4 Publicação | ✔ | ✔ (Res. 594 art. 4º § 1º VIII, avisos) | ✔ | |
| 5 Perfis | ✔ | ✔ (fonte obrigatória, nada pré-carregado) | ✔ | |
| 6 Diálogo | | ✔ (critério, "Sugestão: confira") | ✔ | |
| 7 Editor | | ✔ (texto livre, VET) | ✔ | |
| 8 Biblioteca | ✔ | ✔ (observação, LGPD art. 6º III) | ✔ | |
| 9 Ligado ao plano | ✔ | ✔ (RN-12) | ✔ | |
| 10 Leitores | ✔ | ✔ (CS-232, exportação, IA Nutri) | ✔ | |
| 11 Fechamento | | | ✔ | ✔ |
| 12 Seed USDA | ✔ (NO FORCE, migrator) | ✔ (marcas, tradução, citação) | | ✔ |

## Migrations antes do PR (`sessoes-paralelas.md` §5)

Antes de abrir o PR do código (e de novo se outro PR com migration entrar na `main` antes):

1. `git fetch origin`; listar as migrations do branch (`git diff --name-only --diff-filter=A origin/main...HEAD -- drizzle/`) e guardá-las em `../migrations-b/`, anotando a ordem (gerada com o preenchimento editado à mão → `rls_biblioteca_plano` → `rls_plano_ligados` → `plano19_fks_dias_conteudos`).
2. (Atalho) commit que volta `drizzle/` ao merge-base; `git rebase origin/main`; conflito no schema = juntar as duas mudanças.
3. Remover os SQL, snapshots e o journal do branch (`git diff origin/main -- drizzle/` vazio).
4. `pnpm db:generate` e **reaplicar a edição à mão** do preenchimento de `foods` (bloco NO FORCE/UPDATE/FORCE antes dos CHECKs; procurar o comentário `-- Plano 19 (editado à mão)`). Se não der para encaixar, regenerar por etapas.
5. Recriar as três custom na ordem original e colar o SQL guardado; conferir regras 2 e 8.
6. Encadeamento (`_journal.json`, `prevId`, `pnpm drizzle-kit check`); `grep -rn "<número antigo>" src test docs CLAUDE.md`.
7. Com OK do dono (é apagar, mesmo em dev): parar `next dev` e worker da sessão, `dropdb nutri_dev_b`, `scripts/sessao-paralela.sh b plano-19-plano-alimentar-2` (recria e migra do zero).
8. `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/plano19-banco.test.ts src/db/migrate-owner.test.ts` e a suíte toda antes do push.

Só um PR com migration na fila por vez. O PR do seed (Tarefa 12) refaz os passos 1 a 8 sobre a `main` com o PR do código já mesclado.

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (o do código e, depois, o do seed): revisão final do branch (workflow, com `revisor-rls`, `normas-cfn-lgpd`, `revisor-interface` e `guardiao-manual`) → uma onda de correções → `/code-review high` no PR **uma vez** → correções Critical/Important (Minor vai para o backlog) → re-revisão **só do diff das correções** → `/security-review` (checklist reforçado: RLS da biblioteca e das ligações, RN-12 ampliada e o PDF com `?de=plano`, CS-232) → **portão da IA Nutri** (PM-PA15): nova avaliação da RN-184 pelo dono, com casos de lista de substituição, texto livre e dias (`docs/operacao/ia.md`) → merge **só com o OK do dono** (merge = deploy; a migration roda no boot do `nutri_app`; avisar do risco do snapshot com a produção no ar). A orquestradora escalona as revisões pesadas com as outras sessões e atualiza o painel do backlog Paridade Dietbox.
