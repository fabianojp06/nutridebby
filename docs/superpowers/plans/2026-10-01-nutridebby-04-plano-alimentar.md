# Plano 04 — Plano alimentar (M3): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nutricionista busca alimentos (TACO 4ª ed. + os seus), monta o plano alimentar do paciente com refeições, itens, medidas caseiras e substituições, vê os totais e a meta recalculados ao vivo, salva sozinho, reaproveita modelos, publica com versionamento e entrega um PDF com a sua marca gerado pelo worker.

**Architecture:** Módulo novo `src/modules/alimentos` (TACO, medidas caseiras, busca, alimentos próprios) e `src/modules/plano-alimentar` (cálculo RN-02 puro e compartilhado entre cliente, servidor e PDF; rascunho com salvamento por diferença e trava de revisão; publicação RN-01; modelos; PDF no worker). `foods` é a única tabela com `tenant_id` nulo e RLS ao mesmo tempo: a política padrão `tenant_isolation` continua (escrita só nas próprias linhas) e uma política extra **só de leitura** libera as linhas da TACO. A TACO e as medidas do IBGE entram por migrations geradas a partir de CSVs versionados, com teste que confere o CSV contra a planilha original. O editor é um componente cliente que calcula tudo localmente (≤ 100 ms) e salva por `PUT` com debounce; o servidor aplica só o que mudou (o `audit_log` registra só as mudanças). Publicar arquiva a versão anterior na mesma transação, congela os nutrientes nos itens e enfileira o PDF.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Route Handlers, Server Actions, `PageProps`/`RouteContext`) · React 19.2 · PostgreSQL 16 (`pg_trgm` + `unaccent` com wrapper `IMMUTABLE`, índice GIN, índices únicos parciais, políticas RLS extras) · Drizzle 0.45 · pg-boss 12.34 · Zod 4 · `@react-pdf/renderer` 4.9 (já na imagem, só no worker) · `xlsx` 0.20.3 da SheetJS (**novo, só devDependency**: lê as planilhas oficiais no script de seed e no teste de fidelidade) · Vitest 5 + Testcontainers · Playwright 1.63.

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.5: §6 INT-04, §7 `foods`/`food_measures`/`meal_plans`/`meals`/`meal_items`, §8 RN-01/RN-02, §11 P-10) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md) (US-020 a US-026; US-041 para o que o portal vai ler no Plano 06). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P04-01 a P04-09).

## Global Constraints

- Tudo dos Planos 01–03 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` na entrada de toda página e Server Action da nutricionista; `requireApiNutri` em todo Route Handler dela; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500).
- Toda tabela nova com `tenant_id`: depois de `pnpm db:generate`, migration custom `rls_<tabela>` com `SELECT app_enable_tenant_rls('<tabela>');` e, com `patient_id`, `SELECT app_enable_patient_rls('<tabela>');` + `SELECT app_enable_audit('<tabela>', 'plano_alimentar');` (CLAUDE.md regras 2 e 8). Entrada nova em `FABRICAS` de `test/isolamento.test.ts` (fábrica que precisa de linha-mãe cria a mãe no mesmo comando; tabela referenciada com FK `RESTRICT`/`NO ACTION` entra em `ULTIMAS`).
- **`foods` é exceção controlada** (Decisão D1): mantém `tenant_isolation` (a guarda do CI passa) + política `taco_leitura` só `FOR SELECT USING (tenant_id IS NULL)`. Nenhuma outra tabela ganha linha com `tenant_id` nulo.
- Migrations sempre com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7). Migration de **dados** em `foods` (TACO/IBGE) roda entre `ALTER TABLE foods NO FORCE ROW LEVEL SECURITY` e `ALTER TABLE foods FORCE ROW LEVEL SECURITY` (o dono `nutri_owner` não é superusuário; com RLS forçada, `tenant_id IS NULL` não passa em `app_current_tenant()`).
- RNF-08: planos, refeições e itens são dado de saúde (têm `patient_id`): escritas viram `audit_log` pelo gatilho; ao **devolver** um plano de paciente, `auditRead(tx, { entidade: 'plano_alimentar', entidadeId: planId, patientId })` na mesma transação. Modelos (`patient_id` nulo) também passam pelo gatilho; não há leitura auditada de modelo.
- RN-02 é **uma função pura só** (`src/modules/plano-alimentar/calculo.ts`), usada no editor (cliente), no servidor (validação de publicação) e no PDF. Arredondamento só na exibição: kcal inteiro, gramas com 1 casa (`arredondar`, meio para cima).
- Textos de interface em pt-BR, com o texto exato da spec quando existir: "TACO", "Meu alimento", "Cadastrar medida caseira", "Duplicar como meu alimento", "Alterações não salvas", "Salvar como modelo", "Mostrar calorias ao paciente", "Seu PDF está sendo preparado", "TACO 4ª ed. — NEPA/UNICAMP". Textos novos estão na tabela de desvios (última linha).
- RNF-11 / CLAUDE.md regra 3: nada de nome de alimento, quantidade, nome de paciente ou conteúdo de plano em log; logs só com ids e motivos.
- RNF-12: números com vírgula decimal (`formatarDecimal`, `lerDecimal`), datas `dd/mm/aaaa` (`formatarData`), horário `HH:MM`.
- CLAUDE.md regra 9: o PDF é gravado só por `salvarArquivo` (`tipo: 'plano_pdf'`, `permitidos: ['pdf']`, registro do `pdf_path` no `registrar`), servido só por `signFileUrl`. `@react-pdf/renderer` e o arquivo do PDF ficam **fora do grafo do Next** (nenhum arquivo em `src/app` importa `plano-pdf`; o teste de guarda do Plano 03 é estendido).
- Acessibilidade (padrão dos Planos 02–03): `<label for>`, `aria-invalid`, `aria-describedby`, erros com `role="alert"`, sucesso/estado com `role="status"`; o indicador de meta tem **texto**, não só cor; a busca é navegável por teclado.
- Custo zero. Dependência nova: **só** `xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` em `devDependencies` (o pacote `xlsx` do npm parou na 0.18.5, com falhas conhecidas). As planilhas oficiais ficam em `seeds/fontes/` (≈ 1 MB), fora da imagem (`.dockerignore`).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel ou serviços neste plano; nunca exibir segredos. Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes.
- Política de revisão por entrega (índice): revisor por tarefa → `/code-review high` no PR → correções → `/code-review high` (precisa sair limpo) → `/security-review` com o checklist reforçado do fechamento. Se sobrar problema confirmado depois da 3ª rodada, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**: sem ele, nada de pacientes reais.

### Decisões de desenho (tomadas neste plano)

| # | Tema | Decisão | Custo / consequência |
|---|---|---|---|
| D1 | RLS de `foods` (TACO com `tenant_id` nulo) | `app_enable_tenant_rls('foods')` (escrita e leitura das próprias linhas) + política extra `taco_leitura AS PERMISSIVE FOR SELECT USING (tenant_id IS NULL)`. TACO fica imutável para a aplicação porque `UPDATE`/`DELETE` só enxergam as políticas `FOR ALL` | A matriz de isolamento ganha um caso só para `foods` (B também vê as linhas nulas) e um teste próprio prova que a TACO não pode ser alterada, apagada nem criada pela aplicação |
| D2 | Ids da TACO | Determinísticos: `00000000-0000-4000-8000-` + número TACO com 12 dígitos (Arroz tipo 1 cozido = `…-000000000003`); coluna `taco_id smallint UNIQUE` | Mesmos ids em dev, CI e produção; testes e E2E citam alimentos por id |
| D3 | Origem dos dados | `seeds/fontes/Taco_4a_edicao_2011.xls` (planilha original da NEPA, espelho fixado por commit, sha256 conferido) → `seeds/taco-4ed.csv` → migration SQL gerada. `seeds/fontes/ibge-tabelamedidas_bd.zip` (FTP do IBGE) → curadoria manual em `seeds/medidas-ibge.csv` (uma linha por medida, citando a descrição exata do IBGE) → migration gerada | Um teste refaz o CSV a partir da planilha e compara byte a byte; outro confere que a migration de medidas bate com o CSV. Ampliar a lista (E-08) = editar o CSV e gerar uma migration nova |
| D4 | Valores especiais da TACO | `Tr` → 0; `NA`, `*` ("análises sendo reavaliadas") e vazio → `NULL`; a célula com erro de digitação `,0,02` (alimento 373, piridoxina) → 0,02 por correção explícita no conversor | 4 alimentos têm energia `*` (ex.: "Leite, de vaca, integral"): no editor aparecem com o aviso "Sem valor na TACO" e contam 0 na soma, sem `NaN` (Review Focus 3) |
| D5 | Medidas caseiras | Seed IBGE em `foods.medidas_caseiras` (`[{ nome, plural, gramas }]`); medidas da nutricionista em `food_measures` 🔒 (mesmos campos). O item guarda `medida` (`{ nome, plural, gramas, qtd }`, cópia) e `medida_caseira_txt` ("4 colheres de sopa cheias"); singular quando `qtd < 2` | O texto do item não muda se a medida for apagada ou corrigida depois |
| D6 | Busca (≤ 300 ms) | Função `app_unaccent(text) IMMUTABLE` (o `unaccent` é `STABLE` e não entra em índice) + índice GIN `gin_trgm_ops` em `app_unaccent(lower(nome))`; cada palavra digitada vira um `LIKE '%palavra%'` e a ordem é: começa com a 1ª palavra → `similarity` → nome mais curto | Busca tolerante a acento e a ordem das palavras ("feijao carioca") |
| D7 | Salvamento automático | `PUT /api/painel/planos/[id]` com o rascunho inteiro + `revisao`; debounce de 800 ms; o servidor compara com o banco e aplica só inserções/alterações/remoções. `revisao` diferente → 409 ("Este plano foi alterado em outra aba. Recarregue a página para continuar."). Sem rede → "Alterações não salvas" e nova tentativa ao voltar a conexão (`online`) e a cada 5 s | Um `audit_log` por item realmente alterado (não 80 linhas a cada 2 s); duas abas não se sobrescrevem em silêncio (Review Focus 1) |
| D8 | Ids de refeição/item | Gerados no cliente (`crypto.randomUUID()` no evento, nunca no render) e aceitos pelo servidor só se forem novos ou já deste plano | Diff estável sem ida e volta ao servidor |
| D9 | Substituições | `meal_items.substitui_item_id` (FK para o item principal **da mesma refeição**) em vez de `grupo_substituicao smallint` | Liga cada substituição ao seu principal sem número mágico; apagar o principal apaga as substituições (cascade) |
| D10 | Plano publicado imutável (RN-01) | Ao publicar, cada item recebe `nutrientes` (cópia dos valores por 100 g e do nome do alimento); a tela, o PDF e o portal (Plano 06) leem a cópia. "Editar" cria o rascunho `versao + 1` com os valores atuais dos alimentos | Corrigir um "Meu alimento" depois não muda um plano já publicado (Review Focus 4) |
| D11 | Um rascunho por paciente | Índice único parcial (`tenant_id`, `patient_id`) `WHERE status = 'rascunho' AND patient_id IS NOT NULL`, além do índice de 1 publicado (RN-01) | "Editar" num paciente que já tem rascunho abre o rascunho existente |
| D12 | Paciente nunca vê rascunho | Política `RESTRICTIVE` `paciente_sem_rascunho` em `meal_plans`, `meals` e `meal_items`: para `app.role = 'paciente'`, só linhas de planos com `status <> 'rascunho'` | Garantia no banco, não só na API (US-025 "nem pela API"); vale já para o portal do Plano 06 |
| D13 | PDF | Fila `plano-pdf` enfileirada na transação da publicação; o worker gera com `@react-pdf/renderer` (Helvetica/WinAnsi, como o prontuário) e grava `pdf_path` + `pdf_status = 'pronto'` no `registrar`. Cota esgotada ou última tentativa → `pdf_status = 'falhou'` | O painel mostra "Seu PDF está sendo preparado" e atualiza sozinho; falha vira mensagem e botão "Gerar o PDF de novo" |
| D14 | Marca no worker | `getTenantBrand` importa `server-only` (quebra no worker): o PDF usa `tenant.corPrimaria ?? COR_PADRAO` e o logo lido de `resolverCaminho(DATA_DIR, tenant.logoPath)` (sempre PNG, Plano 02) | Mesma marca do painel, sem tocar no módulo da marca |
| D15 | g/kg | Peso da última antropometria (`medidasRecentes`, leitura auditada); sem antropometria, a coluna mostra "—" e a dica "Registre a antropometria para ver g/kg" | Modelos não têm paciente: a coluna g/kg não aparece |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano — v1.6)

| Spec | Neste plano | Motivo |
|---|---|---|
| US-025 "P recebe push 'Seu novo plano alimentar está disponível'" | **Adiado para o Plano 06** (P06: push + e-mail na publicação). Este plano deixa o gancho `aoPublicar` documentado em `publicacao.ts` | O portal do paciente e o push só existem no Plano 06: um aviso agora levaria o paciente a uma tela vazia |
| INT-04 / P-10 "150 alimentos mais usados" | Seed inicial com **28 alimentos básicos** (44 medidas), cada uma citando a linha do IBGE; os demais 150 entram quando a Debby mandar a lista (E-08), só editando `seeds/medidas-ibge.csv` | A lista da Debby ainda não chegou; o mecanismo inteiro fica pronto e testado |
| `meal_items.grupo_substituicao smallint` | `meal_items.substitui_item_id uuid` (D9) | Liga a substituição ao principal sem ambiguidade |
| §7 `meals`/`meal_items` sem `tenant_id`/`patient_id` | As duas ganham `tenant_id` 🔒 e `patient_id` (nulo em modelo), e `meal_items` ganha `plan_id` | Convenção do projeto (RLS por paciente e FK composta em toda tabela filha) e política D12 sem `JOIN` em duas camadas |
| `meal_plans` | Colunas a mais: `revisao` (D7), `orientacoes` (texto livre do plano, vai no PDF), `pdf_status` (`pendente`/`pronto`/`falhou`, D13), `updated_at` | Salvamento concorrente, "orientações" da US-026 e estado do PDF |
| `meal_items` | Colunas a mais: `medida jsonb` (D5), `nutrientes jsonb` (D10), `ordem` | Texto da medida estável, plano publicado imutável, ordem dos itens |
| `meals.recipe_content_id` | Fica para o Plano 07 (P07-05, quando `contents` existir) | Não há tabela para referenciar ainda |
| `meal_plans.energy_calc_id` como FK | Referência sem FK (o serviço confere que o cálculo é do mesmo paciente) | `ON DELETE SET NULL` numa FK composta zeraria também `tenant_id`; a meta fica gravada em `meta_kcal` de qualquer forma |
| `meal_items.quantidade_g` CHECK > 0 | CHECK entre 0,1 e 5000 g | Quantidade absurda (99999 g) é erro de digitação, não plano (Review Focus 2) |
| Textos novos de interface | Alimentos: "Sem valor na TACO"; "Alimento não encontrado."; "Informe o nome do alimento (2 a 120 caracteres)"; "Escolha o grupo do alimento"; "Valores por 100 g: energia entre 0 e 900 kcal; os demais entre 0 e 100 g"; "Alimentos da TACO não podem ser alterados. Use \"Duplicar como meu alimento\"."; "Este alimento está em um plano e não pode ser excluído."; "A TACO não tem todos os valores deste alimento: confira os campos com 0."; "Cadastrar meu alimento"; "Sem medida caseira: no plano, informe a quantidade em gramas ou cadastre uma medida abaixo."; "Informe o nome da medida e o plural"; "Gramas da medida devem estar entre 0,1 e 5000"; "Você já tem uma medida com esse nome para este alimento."; "Medida \"{nome}\" cadastrada."; "Não foi possível buscar agora. Tente de novo." · Plano: "Quantidade deve estar entre 0,1 e 5000 g"; "Informe a quantidade da medida (ex.: 2 ou 1,5)"; "Meta deve estar entre 500 e 10000 kcal"; "Cálculo de gasto energético não encontrado."; "Informe o título do plano (até 120 caracteres)"; "Informe o nome da refeição (até 60 caracteres)"; "Horário inválido (use HH:MM)"; "A substituição precisa estar ligada a um alimento principal da mesma refeição."; "O plano pode ter até 15 refeições e 200 itens."; "Texto muito longo (até 2000 caracteres)."; "Dentro da meta" / "Atenção" / "Fora da meta"; "Registre a antropometria para ver g/kg"; "Salvando…" / "Salvo" / "Alterações não salvas" / "Corrija os campos destacados para salvar."; "Este plano foi alterado em outra aba. Recarregue a página para continuar."; "Não foi possível salvar estes dados. Recarregue a página."; "Plano grande demais."; "Plano não encontrado."; "Este plano já foi publicado e não pode ser alterado. Use \"Editar\" para criar uma nova versão."; "Já existe um rascunho para este paciente."; "Inclua pelo menos uma refeição com um alimento para publicar."; "Informe o horário de todas as refeições."; "A refeição \"{nome}\" não tem alimentos."; "Plano publicado."; "Não foi possível gerar o PDF. Tente de novo." / "Gerar o PDF de novo" / "O PDF já está sendo preparado."; "Criar plano"; "Continuar o rascunho (versão N)"; "Editar o plano publicado"; "Descartar rascunho"; "Usar como meta do plano"; "Orientações gerais"; "Adicionar refeição"; "Adicionar substituição para {alimento}"; "Modelos de plano"; "Criar modelo"; "Modelo salvo."; "Excluir modelo" | Formulários e estados novos |

### Itens adiados de planos anteriores

**Incorporados** (a tarefa que resolve está entre parênteses):
- Plano 03 (b): normalizar texto (trim + espaços) num helper só, `normalizarTexto` em `src/lib/text.ts`, e trocar as 4 cópias (`exames.ts`, `anamnese-tipos.ts`, `etiquetas.ts`, `atendimentos.ts`) (Tarefa 4).
- Plano 03 (c): limpeza dos `.tmp` órfãos de `salvarArquivo` no worker (fila diária `limpar-tmp`) (Tarefa 11).
- PR #4: normalizar `APP_URL` uma vez no `env.ts` (sem query, sem hash, sem barra no fim) para o `urlDoApp` nunca montar link quebrado (Tarefa 3).
- Plano 03, "anotar para o P04-05": botão "Usar como meta do plano" ligando `meal_plans.energy_calc_id`/`meta_kcal` ao `energy_calcs` (Tarefa 7). "P04-09 reaproveitar `@react-pdf/renderer`" (Tarefa 11; `getTenantBrand` não, ver D14).

**Não incorporados** (motivo):
- Plano 03 (a): restringir `stored_files` por paciente — continua para o **Plano 06** (é o portal que passa a ler arquivos como paciente; o PDF do plano só é baixado pela equipe neste plano).

## Review Focus

1. **Duas abas ou salvamentos fora de ordem.** A nutricionista edita o mesmo rascunho em duas abas, ou um `PUT` lento chega depois de um mais novo. Esperado: o segundo a chegar com `revisao` velha recebe 409 e a tela mostra "Este plano foi alterado em outra aba. Recarregue a página para continuar."; nada é sobrescrito em silêncio. Testes na Tarefa 6.
2. **Quantidade digitada errada.** "1,5", "1.5", " 150 ", "abc", "0", "-10", "99999", vazio. Esperado: vírgula e ponto aceitos; o resto vira "Quantidade deve estar entre 0,1 e 5000 g" no item, nunca `NaN` no total nem 500. Testes nas Tarefas 5 e 6.
3. **Alimento sem valor na TACO.** "Leite, de vaca, integral" (energia `*`) ou "Azeite, de oliva" (proteína `NA`). Esperado: o item mostra "Sem valor na TACO" no nutriente que falta, a soma trata como 0, nenhum total vira `NaN`, o PDF mostra "—". Testes nas Tarefas 1, 5 e 11.
4. **Alimento próprio alterado ou apagado depois de usado.** A nutricionista corrige as kcal do "Pão low carb" que está no plano publicado de Ana, ou tenta excluí-lo. Esperado: o plano publicado continua igual (cópia dos nutrientes, D10); excluir é recusado com "Este alimento está em um plano e não pode ser excluído."; um rascunho passa a usar o valor novo. Testes nas Tarefas 4 e 10.
5. **Paciente lendo o banco direto.** Uma sessão de paciente (RLS `paciente`) consulta `meal_plans`, `meals`, `meal_items` sem filtro. Esperado: só linhas de planos publicados ou arquivados **dela**; rascunhos e modelos nunca aparecem. Testes na Tarefa 10 (e na matriz de isolamento, Tarefa 6).

---

## Estrutura de arquivos

```
seeds/
  fontes/Taco_4a_edicao_2011.xls          # T1 — planilha original NEPA (sha256 conferido)
  fontes/ibge-tabelamedidas_bd.zip        # T2 — IBGE POF 2008–2009 (sha256 conferido)
  fontes/LEIA-ME.md                       # T1 — origem, citação obrigatória, como ampliar
  taco-4ed.csv                            # T1 — gerado por `pnpm seed:taco` (não editar à mão)
  medidas-ibge.csv                        # T2 — curadoria manual (28 alimentos iniciais; E-08 amplia)
scripts/seeds/planilhas.ts · gerar-taco.ts · gerar-medidas.ts      # T1, T2
drizzle/
  0038_alimentos (gerada) · 0039_seed_taco (custom, script) · 0040_rls_alimentos (custom)            # T1
  0041_medidas_caseiras (gerada) · 0042_seed_medidas_ibge (custom, script) · 0043_rls_medidas (custom) # T2
  0044_planos_alimentares (gerada) · 0045_rls_planos_alimentares (custom)                             # T6
src/db/schema/alimentos.ts                # T1, T2 — foods, food_measures
src/db/schema/plano-alimentar.ts          # T6 — meal_plans, meals, meal_items
src/db/errors.ts                          # T4 — fkViolation
src/lib/csv.ts (+test) · text.ts (+test)  # T2, T4 — lerCsv, normalizarTexto
src/env.ts (+test)                        # T3 — APP_URL normalizado
src/modules/alimentos/
  grupos.ts · taco.ts (+ taco.test, taco-fonte.test, foods-rls.test)   # T1
  medidas-constantes.ts · medidas.ts (+ test, medidas-fonte.test)      # T2
  busca.ts (+test)                        # T3
  alimentos-constantes.ts · alimentos.ts (+test)                       # T4
src/modules/plano-alimentar/
  constantes.ts · calculo.ts (+test)      # T5 — RN-02 puro (cliente, servidor e PDF)
  tipos.ts · erros.ts · carregar.ts · rascunho.ts (+test)              # T6
  meta.ts (+test)                         # T7
  modelos.ts (+test)                      # T9
  publicacao.ts (+test)                   # T10, T11 (pedirNovoPdf)
  plano-pdf.tsx · plano-pdf-job.ts (+test)                             # T11 — só worker
src/modules/plataforma/audit.ts · armazenamento.ts (+test)             # T6, T11
src/modules/pacientes/exportacao-job.ts (+ exportacao.test) · lgpd.ts  # T6, T11
src/jobs/queues.ts · src/worker/index.ts  # T10, T11 — filas plano-pdf e limpar-tmp
src/app/api/painel/alimentos/route.ts (+test)          # T3
src/app/api/painel/planos/[id]/route.ts (+test)        # T6 — GET, PUT
src/app/painel/alimentos/…                # T3, T4 — busca, novo, [id], [id]/editar, actions, formulários
src/app/painel/planos/editor/…            # T7, T8 — estado.ts (+test), use-salvamento.ts, painel-totais.tsx, editor-plano.tsx
src/app/painel/planos/modelos/… · salvar-como-modelo.tsx               # T9
src/app/painel/pacientes/[id]/plano-alimentar/…                        # T7, T9, T10, T11 — versões, actions, botao-acao, criar-de-modelo, [planId] (editor, PDF)
src/app/painel/pacientes/[id]/abas.tsx · src/app/painel/cabecalho.tsx  # T3, T7, T9 — navegação
test/nutri.ts · test/pdf.ts · test/isolamento.test.ts                  # T3, T11, T1/T2/T6
e2e/plano-alimentar.spec.ts               # T3, T4, T7–T11
```

**Ordem e dependências das tarefas:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. As Tarefas 5 (cálculo) e 1–4 (alimentos) não dependem entre si, mas o editor (7) precisa das duas.

---

### Task 1: Tabela TACO — fonte oficial, conversor, seed e RLS de leitura compartilhada (P04-01)

**Files:**
- Create: `seeds/fontes/Taco_4a_edicao_2011.xls`, `seeds/fontes/LEIA-ME.md`, `seeds/taco-4ed.csv` (gerado), `scripts/seeds/planilhas.ts`, `scripts/seeds/gerar-taco.ts`, `src/modules/alimentos/grupos.ts`, `src/modules/alimentos/taco.ts`, `src/modules/alimentos/taco.test.ts`, `src/modules/alimentos/taco-fonte.test.ts`, `src/modules/alimentos/foods-rls.test.ts`, `src/db/schema/alimentos.ts`, `drizzle/0038_alimentos.sql` (gerada), `drizzle/0039_seed_taco.sql` (custom, conteúdo gerado pelo script), `drizzle/0040_rls_alimentos.sql` (custom)
- Modify: `package.json` (devDependency `xlsx`, scripts `seed:taco`/`seed:medidas`), `.dockerignore`, `src/db/schema/index.ts`, `src/db/rls-guard.ts` (comentário), `test/isolamento.test.ts`

**Interfaces:**
- Consumes: `tenants` (`@/db/schema`); `withTenant`, `TenantContext` (`@/db/tenant`); `makeDb` (`test/db`), `novoTenant`, `novoPaciente`, `ctxPaciente` (`test/pacientes`).
- Produces:
  - Schema `foods` (`tenant_id` nulo = TACO), `type FoodRow`, `type MedidaCaseira = { nome: string; plural: string; gramas: number }` (`@/db/schema/alimentos`).
  - `@/modules/alimentos/grupos`: `GRUPOS_TACO` (os 15 grupos, na ordem da TACO), `type GrupoAlimento`.
  - `@/modules/alimentos/taco`: `TACO_FONTE`, `CAMPOS_MICRO`, `type RegistroTaco`, `idTaco(n: number): string`, `converterTaco(linhas): RegistroTaco[]`, `paraCsvTaco(r): string`, `sqlSeedTaco(r): string`, `FONTE_TACO_TEXTO = 'TACO 4ª ed. — NEPA/UNICAMP'`.
  - SQL: função `app_unaccent(text)` (IMMUTABLE) e índice `foods_busca_idx` (usados na Tarefa 3).

- [ ] **Step 1: Fonte oficial e dependência de desenvolvimento**

```bash
mkdir -p seeds/fontes
# Planilha original da NEPA/UNICAMP (TACO 4ª ed., 2011), espelho fixado por commit
curl -fsSL -o seeds/fontes/Taco_4a_edicao_2011.xls \
  https://raw.githubusercontent.com/raulfdm/taco-api/06e466ad2f3d76064b587808b1804564b2c40f67/references/original-Taco_4a_edicao_2011.xls
echo "b7369a767b14bfe06ff9973957c140b266f9bb7932f870481ef2d99ba0a15ace  seeds/fontes/Taco_4a_edicao_2011.xls" | sha256sum -c
pnpm add -D xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Expected: `seeds/fontes/Taco_4a_edicao_2011.xls: OK` e `xlsx` em `devDependencies`.

`seeds/fontes/LEIA-ME.md`:

```markdown
# Fontes dos dados de alimentos

| Arquivo | Origem | sha256 |
|---|---|---|
| `Taco_4a_edicao_2011.xls` | TACO — Tabela Brasileira de Composição de Alimentos, 4ª ed. revisada e ampliada, NEPA/UNICAMP, 2011. Planilha original, obtida do espelho `raulfdm/taco-api` no commit `06e466ad2f3d76064b587808b1804564b2c40f67` (`references/original-Taco_4a_edicao_2011.xls`) | `b7369a767b14bfe06ff9973957c140b266f9bb7932f870481ef2d99ba0a15ace` |
| `ibge-tabelamedidas_bd.zip` | IBGE — Pesquisa de Orçamentos Familiares 2008–2009: *Tabela de Medidas Referidas para os Alimentos Consumidos no Brasil* (`ftp.ibge.gov.br/Orcamentos_Familiares/Pesquisa_de_Orcamentos_Familiares_2008_2009/Tabela_de_Medidas_Referidas_para_os_Alimentos_Consumidos_no_Brasil/tabelamedidas_bd.zip`) | `3d0ff06acf0b55c22a621f57e6fb218d4505af204ed2be1571bfbe02fbab17c9` |

A TACO pode ser reproduzida desde que citada a fonte: o sistema mostra "TACO 4ª ed. — NEPA/UNICAMP" na tela de alimentos e no rodapé do PDF (INT-04).

- `../taco-4ed.csv` e `../../drizzle/0039_seed_taco.sql` são **gerados** por `pnpm seed:taco`. Não edite à mão: o teste `src/modules/alimentos/taco-fonte.test.ts` refaz os dois a partir da planilha e falha se diferirem.
- `../medidas-ibge.csv` é **curadoria manual** (P-10): cada linha cita a descrição exata do IBGE (coluna "DESCRIÇÃO DO ALIMENTO NA REFERÊNCIA") e os gramas; o teste `medidas-fonte.test.ts` confere cada linha contra a planilha do IBGE. Para ampliar (lista da Debby, E-08): acrescentar linhas, rodar `pnpm drizzle-kit generate --custom --name medidas_ibge_<n>` e `pnpm seed:medidas <arquivo-da-migration>`.
```

Em `package.json`, `scripts`: `"seed:taco": "tsx scripts/seeds/gerar-taco.ts"`, `"seed:medidas": "tsx scripts/seeds/gerar-medidas.ts"`. Em `.dockerignore`, acrescentar a linha `seeds`.

- [ ] **Step 2: Grupos e testes do conversor (falham)**

`src/modules/alimentos/grupos.ts`:

```ts
/** Os 15 grupos da TACO 4ª ed., na ordem da tabela. "Meu alimento" escolhe um deles (lista de compras, RN-13). */
export const GRUPOS_TACO = [
  'Cereais e derivados',
  'Verduras, hortaliças e derivados',
  'Frutas e derivados',
  'Gorduras e óleos',
  'Pescados e frutos do mar',
  'Carnes e derivados',
  'Leite e derivados',
  'Bebidas (alcoólicas e não alcoólicas)',
  'Ovos e derivados',
  'Produtos açucarados',
  'Miscelâneas',
  'Outros alimentos industrializados',
  'Alimentos preparados',
  'Leguminosas e derivados',
  'Nozes e sementes',
] as const;

export type GrupoAlimento = (typeof GRUPOS_TACO)[number];

export const ehGrupo = (v: unknown): v is GrupoAlimento => typeof v === 'string' && (GRUPOS_TACO as readonly string[]).includes(v);
```

`src/modules/alimentos/taco.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { converterTaco, idTaco, paraCsvTaco, sqlSeedTaco } from './taco';

// Linhas no formato da aba "CMVCol taco3": 3 de cabeçalho, linha de grupo (só a 1ª célula), linhas de alimento, "Legenda"
const vazio = (n: number) => Array.from({ length: n }, () => '');
const alimento = (id: number, nome: string, valores: Record<number, string>) => {
  const l: string[] = [String(id), nome, ...vazio(27)];
  for (const [i, v] of Object.entries(valores)) l[Number(i)] = v;
  l[13] = String(id); // a planilha repete o número na coluna 13
  return l;
};
const linhas = [
  vazio(29),
  ['Número do', '', 'Umidade', 'Energia', ...vazio(25)],
  ['Alimento', 'Descrição dos alimentos', '(%)', '(kcal)', ...vazio(25)],
  ['Cereais e derivados', ...vazio(28)],
  alimento(1, 'Arroz,  integral, cozido ', { 2: '70.1', 3: '124', 5: '2.6', 6: '1.0', 7: 'NA', 8: '25.8', 9: '2.7', 24: 'Tr' }),
  ['Leite e derivados', ...vazio(28)],
  alimento(458, 'Leite, de vaca, integral', { 3: '*', 5: '*', 6: '*', 8: '*', 9: '*' }),
  alimento(373, 'Carne, bovina, paleta, com gordura, crua', { 3: '159', 5: '21.4', 6: '7.5', 8: '0.0', 26: ',0,02' }),
  ['Legenda', ...vazio(28)],
  ['*', 'as análises estão sendo reavaliadas', ...vazio(27)],
];

describe('conversor da TACO (INT-04)', () => {
  const r = converterTaco(linhas);

  it('lê grupo de cada alimento, limpa espaços do nome e para na legenda', () => {
    expect(r.map((x) => [x.tacoId, x.nome, x.grupo])).toEqual([
      [1, 'Arroz, integral, cozido', 'Cereais e derivados'],
      [458, 'Leite, de vaca, integral', 'Leite e derivados'],
      [373, 'Carne, bovina, paleta, com gordura, crua', 'Leite e derivados'],
    ]);
  });

  it('"Tr" vira 0; "NA", "*" e vazio viram null', () => {
    expect(r[0]).toMatchObject({ kcal: 124, proteinaG: 2.6, lipidioG: 1, carboidratoG: 25.8, fibraG: 2.7 });
    expect(r[0].micros).toMatchObject({ umidade_pct: 70.1, colesterol_mg: null, tiamina_mg: 0, sodio_mg: null });
    expect(r[1]).toMatchObject({ kcal: null, proteinaG: null, lipidioG: null, carboidratoG: null, fibraG: null });
  });

  it('corrige a célula com erro de digitação da planilha (alimento 373, piridoxina ",0,02")', () => {
    expect(r[2].micros.piridoxina_mg).toBe(0.02);
  });

  it('valor inesperado na planilha é erro, não número inventado', () => {
    const ruim = [['Cereais e derivados', ...vazio(28)], alimento(2, 'X', { 3: '12,5' })];
    expect(() => converterTaco(ruim)).toThrow('Valor inesperado na TACO: alimento 2, coluna 3');
  });

  it('id determinístico (D2) e CSV/SQL com aspas escapadas', () => {
    expect(idTaco(3)).toBe('00000000-0000-4000-8000-000000000003');
    expect(idTaco(597)).toBe('00000000-0000-4000-8000-000000000597');
    const csv = paraCsvTaco([{ ...r[0], nome: 'Biscoito, "maria"' }]);
    expect(csv.split('\n')[0]).toMatch(/^taco_id,nome,grupo,kcal,proteina_g,carboidrato_g,lipidio_g,fibra_g,umidade_pct,/);
    expect(csv.split('\n')[1]).toMatch(/^1,"Biscoito, ""maria""",Cereais e derivados,124,2.6,25.8,1,2.7,70.1,,/);
    const sqlTexto = sqlSeedTaco([{ ...r[0], nome: "Pão d'água" }]);
    expect(sqlTexto).toContain(`('00000000-0000-4000-8000-000000000001', 1, 'Pão d''água', 'Cereais e derivados', 124, 2.6, 25.8, 1, 2.7, '{"umidade_pct":70.1,`);
    expect(sqlTexto.trimEnd().endsWith(';')).toBe(true);
  });
});
```

Run: `pnpm test src/modules/alimentos/taco.test.ts`
Expected: FAIL — `Cannot find module './taco'`.

- [ ] **Step 3: Conversor** — `src/modules/alimentos/taco.ts`

```ts
import { GRUPOS_TACO } from './grupos';

/** INT-04: de onde vem o seed e para onde vai. O teste taco-fonte confere o sha256 e refaz CSV e migration. */
export const TACO_FONTE = {
  arquivo: 'seeds/fontes/Taco_4a_edicao_2011.xls',
  sha256: 'b7369a767b14bfe06ff9973957c140b266f9bb7932f870481ef2d99ba0a15ace',
  aba: 'CMVCol taco3',
  csv: 'seeds/taco-4ed.csv',
  migration: 'drizzle/0039_seed_taco.sql',
} as const;

/** Citação obrigatória (tela de alimentos e rodapé do PDF). */
export const FONTE_TACO_TEXTO = 'TACO 4ª ed. — NEPA/UNICAMP';

/** Coluna de cada nutriente na aba "CMVCol taco3" (0 = número, 1 = nome, 13 = número repetido). */
const COL_MACRO = { kcal: 3, proteinaG: 5, lipidioG: 6, carboidratoG: 8, fibraG: 9 } as const;
const COL_MICRO = {
  umidade_pct: 2, colesterol_mg: 7, cinzas_g: 10, calcio_mg: 11, magnesio_mg: 12, manganes_mg: 14, fosforo_mg: 15,
  ferro_mg: 16, sodio_mg: 17, potassio_mg: 18, cobre_mg: 19, zinco_mg: 20, retinol_mcg: 21, re_mcg: 22, rae_mcg: 23,
  tiamina_mg: 24, riboflavina_mg: 25, piridoxina_mg: 26, niacina_mg: 27, vitamina_c_mg: 28,
} as const;

export type CampoMicro = keyof typeof COL_MICRO;
export const CAMPOS_MICRO = Object.keys(COL_MICRO) as CampoMicro[];

/** Erros de digitação conhecidos da planilha original (conferidos no PDF da TACO). */
const CORRECOES: Record<number, Partial<Record<number, string>>> = {
  373: { 26: '0.02' }, // piridoxina digitada como ",0,02"
};

export type RegistroTaco = {
  tacoId: number;
  nome: string;
  grupo: string;
  kcal: number | null;
  proteinaG: number | null;
  carboidratoG: number | null;
  lipidioG: number | null;
  fibraG: number | null;
  micros: Record<CampoMicro, number | null>;
};

/** D2: mesmo id em todo ambiente. 3 → 00000000-0000-4000-8000-000000000003 */
export const idTaco = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const texto = (c: unknown) => String(c ?? '').trim();

/** D4: "Tr" (traço) → 0; "NA" (não aplicável), "*" (em reavaliação) e vazio → null. */
function valor(c: unknown, tacoId: number, col: number): number | null {
  const s = texto(c);
  if (s === 'Tr') return 0;
  if (s === '' || s === 'NA' || s === '*') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Valor inesperado na TACO: alimento ${tacoId}, coluna ${col}`);
  return Number(s);
}

/** Linhas da aba (sheet_to_json com header: 1, raw: false) → registros, na ordem da planilha. */
export function converterTaco(linhas: readonly (readonly unknown[])[]): RegistroTaco[] {
  const out: RegistroTaco[] = [];
  let grupo: string | null = null;
  for (const l of linhas) {
    const a = texto(l[0]);
    if (a === 'Legenda') break;
    if (/^\d+$/.test(a)) {
      const tacoId = Number(a);
      if (!grupo) throw new Error(`Alimento ${tacoId} antes de qualquer grupo`);
      const corr = CORRECOES[tacoId] ?? {};
      const v = (col: number) => valor(corr[col] ?? l[col], tacoId, col);
      const micros = Object.fromEntries(CAMPOS_MICRO.map((k) => [k, v(COL_MICRO[k])])) as RegistroTaco['micros'];
      out.push({
        tacoId,
        nome: texto(l[1]).replace(/\s+/g, ' '),
        grupo,
        kcal: v(COL_MACRO.kcal),
        proteinaG: v(COL_MACRO.proteinaG),
        carboidratoG: v(COL_MACRO.carboidratoG),
        lipidioG: v(COL_MACRO.lipidioG),
        fibraG: v(COL_MACRO.fibraG),
        micros,
      });
    } else if (a && l.slice(1).every((c) => texto(c) === '')) {
      if (!(GRUPOS_TACO as readonly string[]).includes(a)) throw new Error(`Grupo desconhecido na TACO: ${a}`);
      grupo = a;
    }
  }
  return out;
}

const num = (n: number | null) => (n === null ? '' : String(n));
const csvCampo = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV legível (ponto decimal, vazio = sem valor). Gerado; o teste compara com seeds/taco-4ed.csv. */
export function paraCsvTaco(registros: RegistroTaco[]): string {
  const cab = ['taco_id', 'nome', 'grupo', 'kcal', 'proteina_g', 'carboidrato_g', 'lipidio_g', 'fibra_g', ...CAMPOS_MICRO];
  const linhas = registros.map((r) =>
    [String(r.tacoId), csvCampo(r.nome), csvCampo(r.grupo), num(r.kcal), num(r.proteinaG), num(r.carboidratoG), num(r.lipidioG), num(r.fibraG), ...CAMPOS_MICRO.map((k) => num(r.micros[k]))].join(','),
  );
  return `${[cab.join(','), ...linhas].join('\n')}\n`;
}

const sqlTexto = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlNum = (n: number | null) => (n === null ? 'NULL' : String(n));

/** Migration de seed (D3): INSERTs de 100 em 100, separados pelo marcador do migrator do Drizzle. */
export function sqlSeedTaco(registros: RegistroTaco[]): string {
  const cab = '-- Gerado por `pnpm seed:taco` a partir de seeds/fontes/Taco_4a_edicao_2011.xls (TACO 4ª ed., NEPA/UNICAMP). Não editar.\n';
  const blocos: string[] = [];
  for (let i = 0; i < registros.length; i += 100) {
    const valores = registros.slice(i, i + 100).map(
      (r) =>
        `(${sqlTexto(idTaco(r.tacoId))}, ${r.tacoId}, ${sqlTexto(r.nome)}, ${sqlTexto(r.grupo)}, ${sqlNum(r.kcal)}, ${sqlNum(r.proteinaG)}, ${sqlNum(r.carboidratoG)}, ${sqlNum(r.lipidioG)}, ${sqlNum(r.fibraG)}, ${sqlTexto(JSON.stringify(r.micros))})`,
    );
    blocos.push(
      `INSERT INTO "foods" ("id", "taco_id", "nome", "grupo", "kcal", "proteina_g", "carboidrato_g", "lipidio_g", "fibra_g", "micros") VALUES\n${valores.join(',\n')};`,
    );
  }
  return `${cab}${blocos.join('\n--> statement-breakpoint\n')}\n`;
}
```

Run: `pnpm test src/modules/alimentos/taco.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 4: Tabela `foods`** — `src/db/schema/alimentos.ts`

```ts
import { sql } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { GRUPOS_TACO } from '../../modules/alimentos/grupos'; // relativo: o drizzle-kit não resolve o alias @/
import { tenants } from './platform';

export type MedidaCaseira = { nome: string; plural: string; gramas: number };

const porCem = (nome: string) => numeric(nome, { precision: 7, scale: 2, mode: 'number' });
const listaSql = (vs: readonly string[]) => sql.raw(vs.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '));

/**
 * INT-04, US-020, US-021. Valores por 100 g. `tenant_id` nulo = TACO 4ª ed. (somente leitura: política
 * `taco_leitura`, D1); preenchido = "Meu alimento" da nutricionista. `medidas_caseiras` = seed do IBGE (Tarefa 2).
 */
export const foods = pgTable(
  'foods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    tacoId: smallint('taco_id').unique('foods_taco_id_unique'),
    nome: text('nome').notNull(),
    grupo: text('grupo').notNull(),
    kcal: porCem('kcal'),
    proteinaG: porCem('proteina_g'),
    carboidratoG: porCem('carboidrato_g'),
    lipidioG: porCem('lipidio_g'),
    fibraG: porCem('fibra_g'),
    micros: jsonb('micros').$type<Record<string, number | null>>().notNull().default({}),
    medidasCaseiras: jsonb('medidas_caseiras').$type<MedidaCaseira[]>().notNull().default([]),
    /** "Duplicar como meu alimento": de qual alimento (TACO) veio a cópia. Sem FK: só informativo. */
    origemFoodId: uuid('origem_food_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('foods_origem_valida', sql`(${t.tenantId} is null) = (${t.tacoId} is not null)`),
    check(
      'foods_proprio_completo',
      sql`${t.tenantId} is null or (${t.kcal} is not null and ${t.proteinaG} is not null and ${t.carboidratoG} is not null and ${t.lipidioG} is not null and ${t.fibraG} is not null)`,
    ),
    check(
      'foods_valores_faixa',
      sql`coalesce(${t.kcal}, 0) between 0 and 900 and coalesce(${t.proteinaG}, 0) between 0 and 100 and coalesce(${t.carboidratoG}, 0) between 0 and 100 and coalesce(${t.lipidioG}, 0) between 0 and 100 and coalesce(${t.fibraG}, 0) between 0 and 100`,
    ),
    check('foods_grupo_valido', sql`${t.grupo} in (${listaSql(GRUPOS_TACO)})`),
    check('foods_nome_tamanho', sql`char_length(${t.nome}) between 2 and 120`),
    index('foods_tenant_idx').on(t.tenantId),
  ],
);

export type FoodRow = typeof foods.$inferSelect;
```

Em `src/db/schema/index.ts`: `export * from './alimentos';`.

Run: `pnpm db:generate --name alimentos` → `drizzle/0038_alimentos.sql` (confira: `CREATE TABLE "foods"` com os 5 CHECKs e o FK para `tenants`).

- [ ] **Step 5: Script de seed e teste de fidelidade (falha)**

`scripts/seeds/planilhas.ts`:

```ts
import * as XLSX from 'xlsx';

/** Linhas de uma aba como matriz de textos (os números saem como o Excel mostra: "2.5", "Tr", "NA"). */
export function lerAba(conteudo: Buffer, aba: string): string[][] {
  const wb = XLSX.read(conteudo);
  const sheet = wb.Sheets[aba];
  if (!sheet) throw new Error(`Aba não encontrada: ${aba}`);
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
}
```

`scripts/seeds/gerar-taco.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { converterTaco, paraCsvTaco, sqlSeedTaco, TACO_FONTE } from '../../src/modules/alimentos/taco';
import { lerAba } from './planilhas';

const xls = readFileSync(TACO_FONTE.arquivo);
const hash = createHash('sha256').update(xls).digest('hex');
if (hash !== TACO_FONTE.sha256) throw new Error(`Planilha da TACO diferente da esperada (sha256 ${hash})`);
const registros = converterTaco(lerAba(xls, TACO_FONTE.aba));
writeFileSync(TACO_FONTE.csv, paraCsvTaco(registros));
writeFileSync(TACO_FONTE.migration, sqlSeedTaco(registros));
console.log(`${registros.length} alimentos da TACO em ${TACO_FONTE.csv} e ${TACO_FONTE.migration}`);
```

`src/modules/alimentos/taco-fonte.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerAba } from '../../../scripts/seeds/planilhas';
import { GRUPOS_TACO } from './grupos';
import { converterTaco, paraCsvTaco, sqlSeedTaco, TACO_FONTE } from './taco';

describe('seed da TACO fiel à planilha oficial (INT-04, D3)', () => {
  const xls = readFileSync(TACO_FONTE.arquivo);
  const registros = converterTaco(lerAba(xls, TACO_FONTE.aba));

  it('a planilha é a esperada (sha256) e tem 597 alimentos nos 15 grupos, numerados de 1 a 597', () => {
    expect(createHash('sha256').update(xls).digest('hex')).toBe(TACO_FONTE.sha256);
    expect(registros).toHaveLength(597);
    expect(registros.every((r, i) => r.tacoId === i + 1)).toBe(true);
    expect([...new Set(registros.map((r) => r.grupo))]).toEqual([...GRUPOS_TACO]);
  });

  it('valores conferidos no PDF da TACO', () => {
    const por = (id: number) => registros.find((r) => r.tacoId === id)!;
    expect(por(3)).toMatchObject({ nome: 'Arroz, tipo 1, cozido', kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 });
    expect(por(561)).toMatchObject({ nome: 'Feijão, carioca, cozido', grupo: 'Leguminosas e derivados', kcal: 76, proteinaG: 4.8, carboidratoG: 13.6, lipidioG: 0.5, fibraG: 8.5 });
    expect(por(458)).toMatchObject({ nome: 'Leite, de vaca, integral', kcal: null }); // "*" — em reavaliação
    expect(por(260)).toMatchObject({ nome: 'Azeite, de oliva, extra virgem', kcal: 884, proteinaG: null, lipidioG: 100 }); // "NA"
    expect(por(42)).toMatchObject({ nome: 'Milho, amido, cru', lipidioG: 0 }); // "Tr"
    expect(por(373).micros.piridoxina_mg).toBe(0.02);
  });

  it('seeds/taco-4ed.csv e a migration de seed são exatamente o que o script gera (rode `pnpm seed:taco`)', () => {
    expect(readFileSync(TACO_FONTE.csv, 'utf8')).toBe(paraCsvTaco(registros));
    expect(readFileSync(TACO_FONTE.migration, 'utf8')).toBe(sqlSeedTaco(registros));
  });
});
```

Run: `pnpm drizzle-kit generate --custom --name seed_taco` (cria `drizzle/0039_seed_taco.sql` vazio e a entrada no journal) e depois `pnpm seed:taco`.
Expected: `597 alimentos da TACO em seeds/taco-4ed.csv e drizzle/0039_seed_taco.sql`.

Run: `pnpm test src/modules/alimentos/taco-fonte.test.ts`
Expected: PASS (3 testes). Abra `seeds/taco-4ed.csv` e confira 3 linhas contra o PDF da TACO (arroz, feijão, leite) antes do commit.

- [ ] **Step 6: Busca sem acento e RLS de leitura compartilhada** — `pnpm drizzle-kit generate --custom --name rls_alimentos` e preencher `drizzle/0040_rls_alimentos.sql`:

```sql
-- D6: unaccent é STABLE e não entra em índice; o wrapper fixa o dicionário e pode ser IMMUTABLE
CREATE OR REPLACE FUNCTION app_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
--> statement-breakpoint
CREATE INDEX foods_busca_idx ON foods USING gin (app_unaccent(lower(nome)) gin_trgm_ops);
--> statement-breakpoint
SELECT app_enable_tenant_rls('foods');
--> statement-breakpoint
-- D1: a TACO (tenant_id nulo) é lida por todos os tenants; só SELECT, então UPDATE/DELETE/INSERT continuam
-- presos à política tenant_isolation (a aplicação nunca altera a TACO)
CREATE POLICY taco_leitura ON foods AS PERMISSIVE FOR SELECT USING (tenant_id IS NULL);
```

Em `src/db/rls-guard.ts`, trocar o comentário `Ex. futuro (Plano 04): foods: …` por: `foods não é exceção: tem tenant_isolation e, além dela, a política taco_leitura (só SELECT) para as linhas da TACO (Plano 04, D1).`

- [ ] **Step 7: Teste da RLS da TACO (falha antes do Step 6, passa depois)** — `src/modules/alimentos/foods-rls.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string };
  return c.code === '42501';
};

describe('RLS de foods: TACO compartilhada e somente leitura (D1)', () => {
  it('o seed tem os 597 alimentos com ids determinísticos', async () => {
    const r = await owner.pool.query(`select count(*)::int as n from foods where tenant_id is null`);
    expect(r.rows[0].n).toBe(597);
    const arroz = await owner.pool.query(`select nome, kcal from foods where id = $1`, [idTaco(3)]);
    expect(arroz.rows[0]).toEqual({ nome: 'Arroz, tipo 1, cozido', kcal: '128.00' });
  });

  it('nutricionista e paciente leem a TACO; ninguém altera, apaga ou cria linha da TACO', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const ctx of [T.ctx, ctxPaciente(T.tenantId, p.id)]) {
      const n = await withTenant(ctx, (tx) => tx.execute(sql`select count(*)::int as n from foods where tenant_id is null`), app.db);
      expect(n.rows[0].n).toBe(597);
    }
    await withTenant(
      T.ctx,
      async (tx) => {
        expect((await tx.execute(sql`update foods set nome = 'x' where taco_id = 3`)).rowCount).toBe(0);
        expect((await tx.execute(sql`delete from foods where taco_id = 3`)).rowCount).toBe(0);
      },
      app.db,
    );
    await expect(
      withTenant(T.ctx, (tx) => tx.execute(sql`insert into foods (nome, grupo, taco_id) values ('Falso', 'Miscelâneas', 9999)`), app.db),
    ).rejects.toSatisfy(violaRls);
    const arroz = await owner.pool.query(`select nome from foods where taco_id = 3`);
    expect(arroz.rows[0].nome).toBe('Arroz, tipo 1, cozido');
  });

  it('"Meu alimento" de A não aparece para B', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    await withTenant(
      A.ctx,
      (tx) => tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
                             values (${A.tenantId}, 'Pão low carb Marca X', 'Cereais e derivados', 250, 12, 8, 18, 6)`),
      app.db,
    );
    const deB = await withTenant(B.ctx, (tx) => tx.execute(sql`select 1 from foods where nome = 'Pão low carb Marca X'`), app.db);
    expect(deB.rows).toHaveLength(0);
  });
});
```

Run: `pnpm test src/modules/alimentos/foods-rls.test.ts`
Expected: PASS (o setup global aplica todas as migrations, inclusive 0038–0040).

- [ ] **Step 8: Matriz de isolamento** — `test/isolamento.test.ts`

No `FABRICAS`:

```ts
  foods: (t) =>
    sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
        values (${t}, 'Iso', 'Miscelâneas', 100, 1, 1, 1, 1)`,
```

`const ULTIMAS = ['anamnesis_templates', 'foods', 'patients'];` (os itens de plano, Tarefa 6, referenciam `foods` com `RESTRICT`).

No teste `'o tenant B só vê e só altera as próprias linhas; as de A ficam intactas'`, trocar o bloco das linhas vistas por:

```ts
          const vistas = await tx.execute(sql`select tenant_id from ${id}`);
          // D1: em foods, B também lê a TACO (tenant_id nulo), mas só altera e apaga as próprias linhas
          const proprias = vistas.rows.filter((row) => row.tenant_id === B);
          expect(proprias.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.tenant_id === B || (t === 'foods' && row.tenant_id === null), t).toBe(true);
          if (SO_INSERE.has(t)) return;
          // UPDATE e DELETE sem filtro: só podem afetar as linhas próprias que a RLS mostrou
          const alteradas = await tx.execute(sql`update ${id} set tenant_id = tenant_id`);
          expect(alteradas.rowCount, t).toBe(proprias.length);
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(proprias.length);
```

Run: `pnpm test src/db test/isolamento.test.ts src/app/admin`
Expected: PASS (a guarda de RLS aceita `foods` porque ela tem `tenant_isolation`).

- [ ] **Step 9: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add seeds scripts/seeds src/modules/alimentos src/db/schema drizzle/0038_alimentos.sql drizzle/0039_seed_taco.sql \
  drizzle/0040_rls_alimentos.sql drizzle/meta src/db/rls-guard.ts test/isolamento.test.ts package.json pnpm-lock.yaml .dockerignore
git commit -m "feat(alimentos): TACO 4ª ed. com seed fiel à planilha oficial, busca sem acento e leitura compartilhada por RLS (P04-01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Medidas caseiras — seed do IBGE (curadoria) e medidas da nutricionista (P04-02)

**Files:**
- Create: `seeds/fontes/ibge-tabelamedidas_bd.zip`, `seeds/medidas-ibge.csv`, `scripts/seeds/gerar-medidas.ts`, `src/lib/csv.ts`, `src/lib/csv.test.ts`, `src/modules/alimentos/medidas-constantes.ts`, `src/modules/alimentos/medidas.ts`, `src/modules/alimentos/medidas.test.ts`, `src/modules/alimentos/medidas-fonte.test.ts`, `drizzle/0041_medidas_caseiras.sql` (gerada), `drizzle/0042_seed_medidas_ibge.sql` (custom, gerada pelo script), `drizzle/0043_rls_medidas.sql` (custom)
- Modify: `src/db/schema/alimentos.ts`, `test/isolamento.test.ts`

**Interfaces:**
- Consumes: `foods`, `type MedidaCaseira`, `idTaco` (Tarefa 1); `lerAba` (Tarefa 1); `lerDecimal`, `arredondar`, `formatarDecimal`, `casasDecimais`, `decimalEntre` (`@/lib/numero`); `primeiroErroPorCampo` (`@/lib/validacao`); `uniqueViolation` (`@/db/errors`); `withTenant`.
- Produces:
  - Schema `foodMeasures` 🔒 (`food_id`, `nome`, `plural`, `gramas`), `type FoodMeasureRow`.
  - `@/lib/csv`: `lerCsv(texto: string): Record<string, string>[]` (RFC 4180, cabeçalho na 1ª linha).
  - `@/modules/alimentos/medidas-constantes`: `MSG_MEDIDA`, `QTD_MEDIDA_MAX = 100`, `textoMedida(qtd: number, m: { nome: string; plural: string }): string`, `gramasDaMedida(qtd: number, gramas: number): number` (sem banco: o editor cliente usa).
  - `@/modules/alimentos/medidas`: `type MedidaDisponivel = MedidaCaseira & { id: string | null; origem: 'IBGE' | 'Minha medida' }`, `MEDIDAS_FONTE`, `sqlSeedMedidas(linhas): string`, `medidasDoAlimento(ctx, foodId, db?): Promise<MedidaDisponivel[]>`, `medidasDeVarios(tx, foodIds): Promise<Map<string, MedidaDisponivel[]>>`, `class MedidaError { erros }`, `cadastrarMedida(ctx, foodId, input, deps?): Promise<MedidaDisponivel>`, `excluirMedida(ctx, id, db?): Promise<boolean>`.

- [ ] **Step 1: Fonte do IBGE e curadoria inicial**

```bash
curl -fsSL -o seeds/fontes/ibge-tabelamedidas_bd.zip \
  https://ftp.ibge.gov.br/Orcamentos_Familiares/Pesquisa_de_Orcamentos_Familiares_2008_2009/Tabela_de_Medidas_Referidas_para_os_Alimentos_Consumidos_no_Brasil/tabelamedidas_bd.zip
echo "3d0ff06acf0b55c22a621f57e6fb218d4505af204ed2be1571bfbe02fbab17c9  seeds/fontes/ibge-tabelamedidas_bd.zip" | sha256sum -c
```

`seeds/medidas-ibge.csv` (28 alimentos, 44 medidas — curadoria inicial; a lista da Debby, E-08, acrescenta linhas). `referencia_ibge` é o texto exato da coluna "DESCRIÇÃO DO ALIMENTO NA REFERÊNCIA"; o feijão usa a referência que o próprio IBGE aplica a "FEIJAO (PRETO, MULATINHO, ROXO, ROSINHA, ETC)":

```csv
taco_id,nome,plural,gramas,referencia_ibge
1,colher de sopa cheia,colheres de sopa cheias,20,Arroz integral cozido - colher de sopa cheia
1,colher de arroz cheia,colheres de arroz cheias,63,Arroz integral cozido - colher de arroz cheia
1,escumadeira média cheia,escumadeiras médias cheias,59,Arroz integral cozido - escumadeira média cheia
3,colher de sopa cheia,colheres de sopa cheias,25,Arroz cozido - colher de sopa cheia
3,colher de arroz cheia,colheres de arroz cheias,45,Arroz cozido - colher de arroz cheia
3,escumadeira média cheia,escumadeiras médias cheias,85,Arroz cozido - escumadeira média cheia
7,colher de sopa cheia,colheres de sopa cheias,15,Aveia flocos - colher de sopa cheia
13,unidade,unidades,5,Biscoito cream cracker - unidade
53,unidade,unidades,50,Pão francês - unidade
78,folha média,folhas médias,10,Alface - folha média
91,colher de sopa cheia,colheres de sopa cheias,30,Batata inglesa cozida - colher de sopa cheia
91,unidade pequena,unidades pequenas,70,Batata inglesa cozida - unidade pequena
91,escumadeira média cheia,escumadeiras médias cheias,80,Batata inglesa cozida - escumadeira média cheia
100,colher de sopa cheia (picado),colheres de sopa cheias (picado),10,Brócolis cozido - colher de sopa cheia picado
110,unidade média,unidades médias,120,Cenoura crua - unidade média
110,colher de sopa cheia (ralada),colheres de sopa cheias (ralada),12,Cenoura crua - colher de sopa cheia ralada
122,colher de sopa cheia,colheres de sopa cheias,16,Farinha de mandioca - colher de sopa cheia
122,colher de sobremesa cheia,colheres de sobremesa cheias,10,Farinha de mandioca - colher de sobremesa cheia
157,fatia média,fatias médias,15,Tomate - fatia média
163,colher de sopa cheia (picado),colheres de sopa cheias (picado),45,Abacate - colher de sopa cheio picado
182,unidade,unidades,75,Banana prata - unidade
214,unidade média,unidades médias,180,Laranja - unidade média
222,unidade média,unidades médias,150,Maçã - unidade média
222,unidade pequena,unidades pequenas,90,Maçã - unidade pequena
226,colher de sopa cheia,colheres de sopa cheias,40,Mamão papaya - colher de sopa cheia
226,unidade pequena,unidades pequenas,270,Mamão papaya - unidade pequena
261,colher de chá cheia,colheres de chá cheias,8,Manteiga - colher de chá cheia
261,ponta de faca,pontas de faca,5,Manteiga - ponta de faca
272,colher de sopa,colheres de sopa,8,Óleo - colher de sopa
377,bife médio,bifes médios,100,Bife bovino - unidade média
448,unidade,unidades,200,Iogurte natural - unidade
461,fatia média,fatias médias,30,Queijo minas frescal - fatia média
463,fatia média,fatias médias,20,Queijo mussarela - fatia média
468,colher de sopa cheia,colheres de sopa cheias,30,Requeijão cremoso - colher de sopa cheia
488,unidade média,unidades médias,45,Ovo de galinha cozido - unidade média
494,colher de chá cheia,colheres de chá cheias,5,Açúcar refinado - colher de chá cheia
494,colher de sopa cheia,colheres de sopa cheias,24,Açúcar refinado - colher de sopa cheia
533,pedaço médio,pedaços médios,135,Cuscuz de milho - pedaço médio
561,colher de sopa cheia,colheres de sopa cheias,17,Feijão branco cozido - colher de sopa cheia
561,colher de arroz cheia,colheres de arroz cheias,35,Feijão branco cozido - colher de arroz cheia
561,concha média cheia,conchas médias cheias,140,Feijão branco cozido - concha média cheia
567,colher de sopa cheia,colheres de sopa cheias,17,Feijão branco cozido - colher de sopa cheia
567,colher de arroz cheia,colheres de arroz cheias,35,Feijão branco cozido - colher de arroz cheia
567,concha média cheia,conchas médias cheias,140,Feijão branco cozido - concha média cheia
```

- [ ] **Step 2: Leitor de CSV** — `src/lib/csv.test.ts` e `src/lib/csv.ts`

```ts
import { describe, expect, it } from 'vitest';
import { lerCsv } from './csv';

describe('lerCsv (RFC 4180)', () => {
  it('cabeçalho na 1ª linha; aspas, vírgula e aspas escapadas dentro do campo; CRLF; linha final vazia', () => {
    expect(lerCsv('a,b\r\n1,"x, ""y"""\r\n2,z\r\n')).toEqual([
      { a: '1', b: 'x, "y"' },
      { a: '2', b: 'z' },
    ]);
  });
  it('linha com número errado de campos é erro com o número da linha', () => {
    expect(() => lerCsv('a,b\n1\n')).toThrow('CSV: linha 2 tem 1 campos, esperava 2');
  });
});
```

```ts
/** CSV simples (RFC 4180) dos seeds: cabeçalho na 1ª linha, campos entre aspas podem ter vírgula e "". */
export function lerCsv(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo || linha.length) linhas.push([...linha, campo]);
  const [cab, ...resto] = linhas.filter((l) => !(l.length === 1 && l[0] === ''));
  return resto.map((l, i) => {
    if (l.length !== cab.length) throw new Error(`CSV: linha ${i + 2} tem ${l.length} campos, esperava ${cab.length}`);
    return Object.fromEntries(cab.map((k, j) => [k, l[j]]));
  });
}
```

Run: `pnpm test src/lib/csv.test.ts` → PASS.

- [ ] **Step 3: Tabela `food_measures`** — acrescentar a `src/db/schema/alimentos.ts` (imports: `unique`):

```ts
/** US-020 "Cadastrar medida caseira": medidas da nutricionista (complementam o seed do IBGE em foods.medidas_caseiras). */
export const foodMeasures = pgTable(
  'food_measures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    plural: text('plural').notNull(),
    gramas: numeric('gramas', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('food_measures_nome_unique').on(t.tenantId, t.foodId, t.nome),
    check('food_measures_gramas_faixa', sql`${t.gramas} between 0.1 and 5000`),
    check('food_measures_nome_tamanho', sql`char_length(${t.nome}) between 2 and 60 and char_length(${t.plural}) between 2 and 60`),
    index('food_measures_alimento_idx').on(t.tenantId, t.foodId),
  ],
);

export type FoodMeasureRow = typeof foodMeasures.$inferSelect;
```

Run: `pnpm db:generate --name medidas_caseiras` → `drizzle/0041_medidas_caseiras.sql`.

Run: `pnpm drizzle-kit generate --custom --name rls_medidas` e preencher `drizzle/0043_rls_medidas.sql` **depois** do Step 5 (a numeração precisa ficar: 0042 = seed, 0043 = RLS; se o `generate` numerar diferente, renomeie o arquivo e a `tag` no `drizzle/meta/_journal.json` na mesma ordem):

```sql
SELECT app_enable_tenant_rls('food_measures');
```

`test/isolamento.test.ts`, no `FABRICAS`:

```ts
  food_measures: (t) =>
    sql`insert into food_measures (tenant_id, food_id, nome, plural, gramas)
        values (${t}, '00000000-0000-4000-8000-000000000003', 'Iso', 'Isos', 10)`,
```

- [ ] **Step 4: Testes das medidas (falham)** — `src/modules/alimentos/medidas.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { gramasDaMedida, MSG_MEDIDA, textoMedida } from './medidas-constantes';
import { cadastrarMedida, excluirMedida, MedidaError, medidasDoAlimento } from './medidas';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof MedidaError) return e.erros;
    throw e;
  }
  throw new Error('esperava MedidaError');
};

describe('texto e gramas da medida (US-020, D5)', () => {
  const colher = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias' };
  it('"Medidas caseiras": 4 colheres de sopa cheias de 25 g = 100 g', () => {
    expect(gramasDaMedida(4, 25)).toBe(100);
    expect(textoMedida(4, colher)).toBe('4 colheres de sopa cheias');
  });
  it('singular abaixo de 2, vírgula decimal, sem zeros à direita', () => {
    expect(textoMedida(1, colher)).toBe('1 colher de sopa cheia');
    expect(textoMedida(0.5, colher)).toBe('0,5 colher de sopa cheia');
    expect(textoMedida(1.5, colher)).toBe('1,5 colher de sopa cheia');
    expect(textoMedida(2.25, colher)).toBe('2,25 colheres de sopa cheias');
    expect(gramasDaMedida(1.5, 17)).toBe(25.5);
    expect(gramasDaMedida(1 / 3, 50)).toBe(16.67);
  });
});

describe('medidas do alimento', () => {
  it('seed do IBGE no arroz tipo 1 cozido: "colher de sopa cheia" (25 g) — cenário da spec', async () => {
    const T = await novoTenant(app.db);
    const ms = await medidasDoAlimento(T.ctx, idTaco(3), app.db);
    expect(ms).toContainEqual({ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
  });

  it('"Alimento sem medida caseira": lista vazia; a medida cadastrada vale só para o tenant que cadastrou', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const chuchu = idTaco(112); // Chuchu, cozido — sem medida no seed
    expect(await medidasDoAlimento(A.ctx, chuchu, app.db)).toEqual([]);
    const m = await cadastrarMedida(A.ctx, chuchu, { nome: ' pires  pequeno ', plural: 'pires pequenos', gramas: '60' }, { db: app.db });
    expect(m).toMatchObject({ origem: 'Minha medida', nome: 'pires pequeno', plural: 'pires pequenos', gramas: 60 });
    expect(await medidasDoAlimento(A.ctx, chuchu, app.db)).toEqual([m]);
    expect(await medidasDoAlimento(B.ctx, chuchu, app.db)).toEqual([]);
    expect(await excluirMedida(B.ctx, m.id!, app.db)).toBe(false);
    expect(await excluirMedida(A.ctx, m.id!, app.db)).toBe(true);
  });

  it('validação: nome/plural, gramas com vírgula, faixa, duplicada e alimento invisível', async () => {
    const A = await novoTenant(app.db);
    const arroz = idTaco(3);
    expect(await erros(cadastrarMedida(A.ctx, arroz, { nome: 'x', plural: '', gramas: '0' }, { db: app.db }))).toEqual({
      nome: MSG_MEDIDA.nome,
      gramas: MSG_MEDIDA.gramas,
    });
    for (const gramas of ['abc', '-1', '5000,5', '']) {
      expect(await erros(cadastrarMedida(A.ctx, arroz, { nome: 'xícara', plural: 'xícaras', gramas }, { db: app.db })), gramas).toEqual({ gramas: MSG_MEDIDA.gramas });
    }
    await cadastrarMedida(A.ctx, arroz, { nome: 'xícara', plural: 'xícaras', gramas: '160,5' }, { db: app.db });
    expect(await erros(cadastrarMedida(A.ctx, arroz, { nome: 'xícara', plural: 'xícaras', gramas: '150' }, { db: app.db }))).toEqual({ nome: MSG_MEDIDA.duplicada });
    expect(await erros(cadastrarMedida(A.ctx, '00000000-0000-4000-8000-999999999999', { nome: 'xícara', plural: 'xícaras', gramas: '1' }, { db: app.db }))).toEqual({
      geral: MSG_MEDIDA.alimento,
    });
    expect(await erros(cadastrarMedida(A.ctx, 'abc', { nome: 'xícara', plural: 'xícaras', gramas: '1' }, { db: app.db }))).toEqual({ geral: MSG_MEDIDA.alimento });
  });
});
```

Run: `pnpm test src/modules/alimentos/medidas.test.ts`
Expected: FAIL — `Cannot find module './medidas-constantes'`.

- [ ] **Step 5: Implementar**

`src/modules/alimentos/medidas-constantes.ts`:

```ts
import { arredondar, casasDecimais, formatarDecimal } from '@/lib/numero';

export const MSG_MEDIDA = {
  nome: 'Informe o nome da medida e o plural',
  gramas: 'Gramas da medida devem estar entre 0,1 e 5000',
  duplicada: 'Você já tem uma medida com esse nome para este alimento.',
  alimento: 'Alimento não encontrado.',
  qtd: 'Informe a quantidade da medida (ex.: 2 ou 1,5)',
} as const;

/** Quantidade de medidas aceita num item (ex.: 4 colheres). */
export const QTD_MEDIDA_MAX = 100;

const qtdTexto = (qtd: number) => formatarDecimal(qtd, casasDecimais(arredondar(qtd, 2)));

/** D5: "4 colheres de sopa cheias"; singular abaixo de 2 ("1,5 colher de sopa cheia"). */
export const textoMedida = (qtd: number, m: { nome: string; plural: string }): string => `${qtdTexto(qtd)} ${qtd < 2 ? m.nome : m.plural}`;

/** quantidade_g do item = medidas × gramas da medida, com 2 casas (coluna numeric(7,2)). */
export const gramasDaMedida = (qtd: number, gramas: number): number => arredondar(qtd * gramas, 2);
```

`src/modules/alimentos/medidas.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { foodMeasures, foods, type MedidaCaseira } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { decimalEntre } from '@/lib/numero';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { MSG_MEDIDA } from './medidas-constantes';

export type MedidaDisponivel = MedidaCaseira & { id: string | null; origem: 'IBGE' | 'Minha medida' };

export const MEDIDAS_FONTE = {
  zip: 'seeds/fontes/ibge-tabelamedidas_bd.zip',
  sha256: '3d0ff06acf0b55c22a621f57e6fb218d4505af204ed2be1571bfbe02fbab17c9',
  xls: 'tabelamedidas_bd.xls',
  aba: 'Tab_Medidas Caseiras',
  csv: 'seeds/medidas-ibge.csv',
  migration: 'drizzle/0042_seed_medidas_ibge.sql',
} as const;

export class MedidaError extends Error {
  override name = 'MedidaError';
  constructor(readonly erros: Record<string, string>) {
    super('Medida inválida');
  }
}

const idValido = (id: unknown): id is string => typeof id === 'string' && z.guid().safeParse(id).success;
const normalizar = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

type LinhaMedida = { taco_id: string; nome: string; plural: string; gramas: string; referencia_ibge: string };

/**
 * Migration de dados (D3): substitui medidas_caseiras de cada alimento do CSV. Roda com a RLS de foods
 * desligada para o dono (com FORCE, tenant_id nulo não passa em app_current_tenant()); foods não é auditada.
 */
export function sqlSeedMedidas(linhas: LinhaMedida[]): string {
  const porAlimento = new Map<number, MedidaCaseira[]>();
  for (const l of linhas) {
    const id = Number(l.taco_id);
    if (!Number.isInteger(id) || id < 1 || id > 597) throw new Error(`taco_id inválido: ${l.taco_id}`);
    const gramas = Number(l.gramas);
    if (!(gramas > 0)) throw new Error(`gramas inválido: ${l.gramas}`);
    porAlimento.set(id, [...(porAlimento.get(id) ?? []), { nome: l.nome, plural: l.plural, gramas }]);
  }
  const updates = [...porAlimento].map(
    ([id, ms]) => `UPDATE "foods" SET "medidas_caseiras" = '${JSON.stringify(ms).replace(/'/g, "''")}'::jsonb WHERE "taco_id" = ${id};`,
  );
  return [
    '-- Gerado por `pnpm seed:medidas` a partir de seeds/medidas-ibge.csv (IBGE, POF 2008–2009). Não editar.',
    'ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY;',
    '--> statement-breakpoint',
    updates.join('\n'),
    '--> statement-breakpoint',
    'ALTER TABLE "foods" FORCE ROW LEVEL SECURITY;',
    '',
  ].join('\n');
}

const deTenant = (r: typeof foodMeasures.$inferSelect): MedidaDisponivel => ({ id: r.id, origem: 'Minha medida', nome: r.nome, plural: r.plural, gramas: r.gramas });

/** Medidas de vários alimentos de uma vez (editor e busca): seed do IBGE primeiro, depois as do tenant. */
export async function medidasDeVarios(tx: Tx, foodIds: string[]): Promise<Map<string, MedidaDisponivel[]>> {
  const ids = [...new Set(foodIds.filter(idValido))];
  const out = new Map<string, MedidaDisponivel[]>();
  if (!ids.length) return out;
  const fs = await tx.select({ id: foods.id, medidas: foods.medidasCaseiras }).from(foods).where(inArray(foods.id, ids));
  for (const f of fs) out.set(f.id, f.medidas.map((m) => ({ ...m, id: null, origem: 'IBGE' as const })));
  const proprias = await tx.select().from(foodMeasures).where(inArray(foodMeasures.foodId, ids)).orderBy(foodMeasures.createdAt);
  for (const m of proprias) out.set(m.foodId, [...(out.get(m.foodId) ?? []), deTenant(m)]);
  return out;
}

export async function medidasDoAlimento(ctx: TenantContext, foodId: string, db: Db = getDb()): Promise<MedidaDisponivel[]> {
  if (!idValido(foodId)) return [];
  return withTenant(ctx, async (tx) => (await medidasDeVarios(tx, [foodId])).get(foodId) ?? [], db);
}

const schemaMedida = z.object({
  nome: z.unknown().transform(normalizar).pipe(z.string().min(2, MSG_MEDIDA.nome).max(60, MSG_MEDIDA.nome)),
  plural: z.unknown().transform(normalizar).pipe(z.string().min(2, MSG_MEDIDA.nome).max(60, MSG_MEDIDA.nome)),
  gramas: decimalEntre(MSG_MEDIDA.gramas, 0.1, 5000),
});

export async function cadastrarMedida(
  ctx: TenantContext,
  foodId: string,
  input: { nome: unknown; plural: unknown; gramas: unknown },
  deps: { db?: Db } = {},
): Promise<MedidaDisponivel> {
  const r = schemaMedida.safeParse(input);
  if (!r.success) {
    const e = primeiroErroPorCampo(r.error);
    if (e.plural && !e.nome) e.nome = e.plural; // uma mensagem só para nome e plural
    delete e.plural;
    throw new MedidaError(e);
  }
  if (!idValido(foodId)) throw new MedidaError({ geral: MSG_MEDIDA.alimento });
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const [f] = await tx.select({ id: foods.id }).from(foods).where(eq(foods.id, foodId)); // RLS: TACO ou do próprio tenant
        if (!f) throw new MedidaError({ geral: MSG_MEDIDA.alimento });
        const [m] = await tx
          .insert(foodMeasures)
          .values({ tenantId: ctx.tenantId, foodId, nome: r.data.nome, plural: r.data.plural, gramas: r.data.gramas })
          .returning();
        return deTenant(m);
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'food_measures_nome_unique') throw new MedidaError({ nome: MSG_MEDIDA.duplicada });
    throw e;
  }
}

export async function excluirMedida(ctx: TenantContext, id: string, db: Db = getDb()): Promise<boolean> {
  if (!idValido(id)) return false;
  const r = await withTenant(ctx, (tx) => tx.delete(foodMeasures).where(and(eq(foodMeasures.id, id))).returning({ id: foodMeasures.id }), db);
  return r.length > 0;
}
```

`scripts/seeds/gerar-medidas.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { lerCsv } from '../../src/lib/csv';
import { MEDIDAS_FONTE, sqlSeedMedidas } from '../../src/modules/alimentos/medidas';

// Uso: pnpm seed:medidas [arquivo-da-migration] (padrão: a migration inicial 0042)
const destino = process.argv[2] ?? MEDIDAS_FONTE.migration;
const linhas = lerCsv(readFileSync(MEDIDAS_FONTE.csv, 'utf8')) as Parameters<typeof sqlSeedMedidas>[0];
writeFileSync(destino, sqlSeedMedidas(linhas));
console.log(`${linhas.length} medidas de ${new Set(linhas.map((l) => l.taco_id)).size} alimentos em ${destino}`);
```

Run: `pnpm drizzle-kit generate --custom --name seed_medidas_ibge` (cria `drizzle/0042_seed_medidas_ibge.sql`) e `pnpm seed:medidas`.
Expected: `44 medidas de 28 alimentos em drizzle/0042_seed_medidas_ibge.sql`. Em seguida gere a `0043_rls_medidas` do Step 3.

Run: `pnpm test src/modules/alimentos/medidas.test.ts`
Expected: PASS.

- [ ] **Step 6: Fidelidade ao IBGE** — `src/modules/alimentos/medidas-fonte.test.ts`

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { lerAba } from '../../../scripts/seeds/planilhas';
import { makeDb } from '../../../test/db';
import { lerCsv } from '@/lib/csv';
import { MEDIDAS_FONTE, sqlSeedMedidas } from './medidas';

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => owner.pool.end());

describe('seed de medidas fiel ao IBGE (INT-04, P-10, D3)', () => {
  const zip = readFileSync(MEDIDAS_FONTE.zip);
  const linhas = lerCsv(readFileSync(MEDIDAS_FONTE.csv, 'utf8'));

  it('cada linha do CSV existe no IBGE com os mesmos gramas (descrição exata da referência)', () => {
    expect(createHash('sha256').update(zip).digest('hex')).toBe(MEDIDAS_FONTE.sha256);
    const xls = Buffer.from(unzipSync(new Uint8Array(zip))[MEDIDAS_FONTE.xls]);
    const ibge = new Map<string, Set<number>>();
    for (const l of lerAba(xls, MEDIDAS_FONTE.aba).slice(4)) {
      const d = String(l[10] ?? '').trim();
      if (d) ibge.set(d, (ibge.get(d) ?? new Set()).add(Number(l[8])));
    }
    const fora = linhas.filter((l) => !ibge.get(l.referencia_ibge)?.has(Number(l.gramas)));
    expect(fora).toEqual([]);
    expect(linhas.length).toBeGreaterThanOrEqual(44);
  });

  it('a migration de seed é o que o script gera (rode `pnpm seed:medidas`) e o banco tem as medidas', async () => {
    expect(readFileSync(MEDIDAS_FONTE.migration, 'utf8')).toBe(sqlSeedMedidas(linhas as Parameters<typeof sqlSeedMedidas>[0]));
    const r = await owner.pool.query(`select medidas_caseiras from foods where taco_id = 3`);
    expect(r.rows[0].medidas_caseiras).toContainEqual({ nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
    const comMedida = await owner.pool.query(`select count(*)::int as n from foods where tenant_id is null and jsonb_array_length(medidas_caseiras) > 0`);
    expect(comMedida.rows[0].n).toBe(new Set(linhas.map((l) => l.taco_id)).size);
  });
});
```

Run: `pnpm test src/modules/alimentos src/lib/csv.test.ts src/db test/isolamento.test.ts`
Expected: PASS. **Quando a lista da Debby chegar (E-08):** acrescentar as linhas no CSV (cada uma com a referência exata do IBGE), `pnpm drizzle-kit generate --custom --name medidas_ibge_2`, `pnpm seed:medidas drizzle/00NN_medidas_ibge_2.sql` e mudar `MEDIDAS_FONTE.migration` para o arquivo novo (o teste passa a conferir a migration mais recente; a antiga continua como está, o UPDATE é idempotente).

- [ ] **Step 7: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add seeds scripts/seeds src/lib/csv.ts src/lib/csv.test.ts src/modules/alimentos src/db/schema/alimentos.ts \
  drizzle/0041_medidas_caseiras.sql drizzle/0042_seed_medidas_ibge.sql drizzle/0043_rls_medidas.sql drizzle/meta test/isolamento.test.ts
git commit -m "feat(alimentos): medidas caseiras do IBGE (28 alimentos, conferidas na planilha) e medidas da nutricionista (P04-02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Busca de alimentos em ≤ 300 ms com selo de origem, API e tela "Alimentos" (P04-03)

**Files:**
- Create: `src/modules/alimentos/busca.ts`, `src/modules/alimentos/busca.test.ts`, `src/app/api/painel/alimentos/route.ts`, `src/app/api/painel/alimentos/route.test.ts`, `test/nutri.ts`, `src/app/painel/alimentos/page.tsx`, `src/app/painel/alimentos/busca-alimento.tsx`, `e2e/plano-alimentar.spec.ts`
- Modify: `src/env.ts`, `src/env.test.ts`, `src/app/painel/cabecalho.tsx`

**Interfaces:**
- Consumes: `foods`, `app_unaccent`, `foods_busca_idx`, `FONTE_TACO_TEXTO` (Tarefa 1); `medidasDeVarios`, `type MedidaDisponivel` (Tarefa 2); `requireApiNutri` (`@/lib/tenant-session`); `requireNutri`; `criarEEntrar` (`test/sessao`), `registrarAceiteDpa`.
- Produces:
  - `@/modules/alimentos/busca`: `type Nutrientes100 = { kcal: number | null; proteinaG: number | null; carboidratoG: number | null; lipidioG: number | null; fibraG: number | null }`, `type AlimentoEncontrado = { id: string; nome: string; grupo: string; origem: 'TACO' | 'Meu alimento'; porCem: Nutrientes100; medidas: MedidaDisponivel[] }`, `BUSCA_LIMITE = 20`, `palavrasDaBusca(termo: unknown): string[]`, `buscarAlimentos(ctx, termo, db?): Promise<AlimentoEncontrado[]>`.
  - `GET /api/painel/alimentos?q=` → `{ resultados: AlimentoEncontrado[] }`.
  - `src/app/painel/alimentos/busca-alimento.tsx`: `BuscaAlimento({ aoEscolher?: (a: AlimentoEncontrado) => void; rotulo?: string })` — sem `aoEscolher`, cada resultado é link para `/painel/alimentos/[id]` (Tarefa 4); com `aoEscolher`, é botão (editor, Tarefa 7).
  - `test/nutri.ts`: `nutriComDpa(db, auth): Promise<{ tenantId; cookie; ctx }>`.
  - `src/env.ts`: `APP_URL` normalizado (sem query, hash nem barra final).

- [ ] **Step 1: `APP_URL` normalizado (item adiado do PR #4)** — em `src/env.test.ts`, acrescentar:

```ts
  it('APP_URL normalizado: sem query, sem hash e sem barras no fim (links montados por urlDoApp)', () => {
    expect(parseEnv({ ...base, APP_URL: 'https://app.exemplo.com//?x=1#y' }).APP_URL).toBe('https://app.exemplo.com');
    expect(parseEnv({ ...base, APP_URL: 'https://exemplo.com/nutri/' }).APP_URL).toBe('https://exemplo.com/nutri');
    expect(parseWorkerEnv({ ...w, APP_URL: 'http://localhost:3100/' }).APP_URL).toBe('http://localhost:3100');
  });
```

(`base` e `w` são os objetos válidos que o arquivo já usa para `parseEnv` e `parseWorkerEnv`.)

Run: `pnpm test src/env.test.ts` → FAIL (o valor volta como foi digitado).

Em `src/env.ts`, criar (acima de `appSchema`):

```ts
/** APP_URL sem query, hash nem barras finais: `urlDoApp` só concatena o caminho (PR #4, item adiado). */
const appUrl = z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }).transform((v) => {
  const u = new URL(v);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
});
```

e trocar as duas ocorrências de `APP_URL: z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }),` (app e worker) por `APP_URL: appUrl,`.

Run: `pnpm test src/env.test.ts` → PASS.

- [ ] **Step 2: Testes da busca (falham)** — `src/modules/alimentos/busca.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { BUSCA_LIMITE, buscarAlimentos, palavrasDaBusca } from './busca';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const proprio = (tenantId: string, nome: string) =>
  sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
      values (${tenantId}, ${nome}, 'Cereais e derivados', 250, 12, 8, 18, 6)`;

describe('busca de alimentos (US-020, D6)', () => {
  it('"Busca tolerante a acento": "feijao carioca" traz "Feijão, carioca, cozido" entre os 5 primeiros, com selo TACO', async () => {
    const T = await novoTenant(app.db);
    const r = await buscarAlimentos(T.ctx, 'feijao carioca', app.db);
    const i = r.findIndex((a) => a.nome === 'Feijão, carioca, cozido');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(5);
    expect(r[i]).toMatchObject({ id: idTaco(561), origem: 'TACO', grupo: 'Leguminosas e derivados', porCem: { kcal: 76, proteinaG: 4.8, carboidratoG: 13.6, lipidioG: 0.5, fibraG: 8.5 } });
  });

  it('maiúsculas, acento invertido e ordem: quem começa com a 1ª palavra vem antes', async () => {
    const T = await novoTenant(app.db);
    expect((await buscarAlimentos(T.ctx, 'PÃO FRANCES', app.db))[0].nome).toBe('Pão, trigo, francês');
    const arroz = await buscarAlimentos(T.ctx, 'arroz', app.db);
    // 7 nomes começam com "Arroz" (6 da TACO + "Arroz carreteiro"); depois vêm "Creme de arroz, pó", "Bolinho de arroz"…
    expect(arroz.slice(0, 7).every((a) => a.nome.startsWith('Arroz'))).toBe(true);
    expect(arroz.slice(7).some((a) => a.nome.startsWith('Arroz'))).toBe(false);
    expect(arroz.map((a) => a.nome)).toContain('Creme de arroz, pó');
    expect(arroz.find((a) => a.id === idTaco(3))?.medidas).toContainEqual({ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
  });

  it('"Origem visível": "Meu alimento" de A aparece para A e nunca para B', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    await withTenant(A.ctx, (tx) => tx.execute(proprio(A.tenantId, 'Pão low carb Marca X')), app.db);
    expect((await buscarAlimentos(A.ctx, 'pao low carb', app.db))[0]).toMatchObject({ nome: 'Pão low carb Marca X', origem: 'Meu alimento' });
    expect(await buscarAlimentos(B.ctx, 'pao low carb', app.db)).toEqual([]);
  });

  it('termo curto, vazio, não-texto ou com curingas do LIKE não lista a tabela inteira', async () => {
    const T = await novoTenant(app.db);
    for (const t of ['', ' ', 'a', null, 42, '%%', '__', '\\\\']) expect(await buscarAlimentos(T.ctx, t, app.db), String(t)).toEqual([]);
    expect(palavrasDaBusca('  Feijão,  carioca ')).toEqual(['feijão', 'carioca']);
    expect(palavrasDaBusca('x'.repeat(200))[0]).toHaveLength(60);
  });

  it(`no máximo ${BUSCA_LIMITE} resultados e p95 ≤ 300 ms com 3000 alimentos próprios no tenant (RNF-01)`, async () => {
    const T = await novoTenant(app.db);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
                       select ${T.tenantId}, 'Produto ' || g || ' integral', 'Cereais e derivados', 100, 1, 1, 1, 1
                       from generate_series(1, 3000) g`),
      app.db,
    );
    const tempos: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await buscarAlimentos(T.ctx, i % 2 ? 'integral' : 'feijao carioca', app.db);
      tempos.push(performance.now() - t0);
      expect(r.length).toBeLessThanOrEqual(BUSCA_LIMITE);
    }
    tempos.sort((a, b) => a - b);
    expect(tempos[Math.ceil(0.95 * tempos.length) - 1]).toBeLessThanOrEqual(300);
  });
});
```

Run: `pnpm test src/modules/alimentos/busca.test.ts`
Expected: FAIL — `Cannot find module './busca'`.

- [ ] **Step 3: Implementar** — `src/modules/alimentos/busca.ts`

```ts
import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { medidasDeVarios, type MedidaDisponivel } from './medidas';

export type Nutrientes100 = { kcal: number | null; proteinaG: number | null; carboidratoG: number | null; lipidioG: number | null; fibraG: number | null };
export type AlimentoEncontrado = { id: string; nome: string; grupo: string; origem: 'TACO' | 'Meu alimento'; porCem: Nutrientes100; medidas: MedidaDisponivel[] };

export const BUSCA_LIMITE = 20;

/** Palavras da busca: minúsculas, até 6 palavras e 60 caracteres (o resto não muda o resultado). */
export function palavrasDaBusca(termo: unknown): string[] {
  if (typeof termo !== 'string') return [];
  return termo
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((w) => w.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 6);
}

/** Curingas do LIKE viram texto literal ("%" não lista a tabela inteira). */
const literal = (w: string) => w.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * US-020 (D6): cada palavra precisa aparecer no nome (sem acento, sem maiúsculas — índice GIN de trigramas
 * em app_unaccent(lower(nome))). Ordem: começa com a 1ª palavra, mais parecido com o termo, nome mais curto.
 * TACO + alimentos do tenant (RLS: tenant_isolation + taco_leitura).
 */
export async function buscarAlimentos(ctx: TenantContext, termo: unknown, db: Db = getDb()): Promise<AlimentoEncontrado[]> {
  const palavras = palavrasDaBusca(termo);
  if (palavras.join('').replace(/[\\%_]/g, '').length < 2) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const nome = sql`app_unaccent(lower(${foods.nome}))`;
      const filtros = palavras.map((w) => sql`${nome} like '%' || app_unaccent(${literal(w)}) || '%'`);
      const rows = await tx
        .select({
          id: foods.id,
          nome: foods.nome,
          grupo: foods.grupo,
          tenantId: foods.tenantId,
          kcal: foods.kcal,
          proteinaG: foods.proteinaG,
          carboidratoG: foods.carboidratoG,
          lipidioG: foods.lipidioG,
          fibraG: foods.fibraG,
        })
        .from(foods)
        .where(sql.join(filtros, sql` and `))
        .orderBy(
          sql`(${nome} like app_unaccent(${literal(palavras[0])}) || '%') desc`,
          sql`similarity(${nome}, app_unaccent(${palavras.join(' ')})) desc`,
          sql`char_length(${foods.nome})`,
          foods.nome,
        )
        .limit(BUSCA_LIMITE);
      const medidas = await medidasDeVarios(tx, rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        grupo: r.grupo,
        origem: r.tenantId === null ? ('TACO' as const) : ('Meu alimento' as const),
        porCem: { kcal: r.kcal, proteinaG: r.proteinaG, carboidratoG: r.carboidratoG, lipidioG: r.lipidioG, fibraG: r.fibraG },
        medidas: medidas.get(r.id) ?? [],
      }));
    },
    db,
  );
}
```

Run: `pnpm test src/modules/alimentos/busca.test.ts`
Expected: PASS (5 testes). Se o p95 passar de 300 ms, confira com `EXPLAIN ANALYZE` (como dono) que o plano usa `foods_busca_idx` — a expressão do `like` precisa ser idêntica à do índice: `app_unaccent(lower(nome))`.

- [ ] **Step 4: API** — `test/nutri.ts`

```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { tenants } from '@/db/schema';
import type { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from './sessao';

/** Nutricionista com DPA aceito e cookie de sessão (testes de Route Handler). */
export async function nutriComDpa(db: Db, auth: ReturnType<typeof getAuth>) {
  const [t] = await db.insert(tenants).values({ slug: `pa-${randomUUID().slice(0, 8)}`, nomeExibicao: 'PA' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { tenantId: t.id, cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
```

`src/app/api/painel/alimentos/route.test.ts`:

```ts
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { nutriComDpa } from '../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const pedir = (q: string | null, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/alimentos${q === null ? '' : `?q=${encodeURIComponent(q)}`}`, { headers: cookie ? { cookie } : {} }));

describe('GET /api/painel/alimentos (US-020)', () => {
  it('200 com resultados e sem cache; sem termo = lista vazia; sem sessão = 401', async () => {
    const A = await nutriComDpa(db, auth);
    const r = await pedir('feijao carioca', A.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { resultados } = await r.json();
    expect(resultados.map((x: { nome: string }) => x.nome)).toContain('Feijão, carioca, cozido');
    expect(await (await pedir(null, A.cookie)).json()).toEqual({ resultados: [] });
    expect((await pedir('feijao')).status).toBe(401);
  });
});
```

`src/app/api/painel/alimentos/route.ts`:

```ts
import { requireApiNutri } from '@/lib/tenant-session';
import { buscarAlimentos } from '@/modules/alimentos/busca';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/** US-020: busca do editor e da tela "Alimentos" (TACO + alimentos do tenant). */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const q = new URL(req.url).searchParams.get('q');
  const resultados = await buscarAlimentos(acesso.ctx, q ?? '');
  return Response.json({ resultados }, { headers: SEM_CACHE });
}
```

Run: `pnpm test src/app/api/painel/alimentos` → PASS.

- [ ] **Step 5: Tela "Alimentos" e componente de busca**

`src/app/painel/alimentos/busca-alimento.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { formatarDecimal } from '@/lib/numero';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';

const kcalTexto = (a: AlimentoEncontrado) => (a.porCem.kcal === null ? 'Sem valor na TACO' : `${formatarDecimal(a.porCem.kcal, 0)} kcal/100 g`);

/** US-020: campo de busca com lista de resultados (setas + Enter). Sem `aoEscolher`, cada resultado é link. */
export function BuscaAlimento({ aoEscolher, rotulo = 'Buscar alimento' }: { aoEscolher?: (a: AlimentoEncontrado) => void; rotulo?: string }) {
  const id = useId();
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<AlimentoEncontrado[]>([]);
  const [ativo, setAtivo] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    const n = ++pedido.current;
    if (termo.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/painel/alimentos?q=${encodeURIComponent(termo)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const { resultados: lista } = (await r.json()) as { resultados: AlimentoEncontrado[] };
        if (n === pedido.current) {
          setResultados(lista);
          setAtivo(0);
          setErro(null);
        }
      } catch {
        if (n === pedido.current) setErro('Não foi possível buscar agora. Tente de novo.');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [termo]);

  const escolher = (a: AlimentoEncontrado) => {
    aoEscolher?.(a);
    setTermo('');
    setResultados([]);
  };

  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-q`} className="block font-medium">{rotulo}</label>
      <input
        id={`${id}-q`}
        type="search"
        role="combobox"
        aria-expanded={resultados.length > 0}
        aria-controls={`${id}-lista`}
        aria-activedescendant={resultados[ativo] ? `${id}-${resultados[ativo].id}` : undefined}
        autoComplete="off"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setAtivo((i) => Math.min(i + 1, resultados.length - 1));
          else if (e.key === 'ArrowUp') setAtivo((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && aoEscolher && resultados[ativo]) {
            e.preventDefault();
            escolher(resultados[ativo]);
          } else return;
          e.preventDefault();
        }}
        className="w-full rounded border p-2"
      />
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <ul id={`${id}-lista`} role="listbox" aria-label="Resultados" className="divide-y rounded border empty:hidden">
        {resultados.map((a, i) => (
          <li key={a.id} id={`${id}-${a.id}`} role="option" aria-selected={i === ativo} className={i === ativo ? 'bg-emerald-50' : ''}>
            {aoEscolher ? (
              <button type="button" onClick={() => escolher(a)} className="flex w-full items-center justify-between gap-2 p-2 text-left">
                <span>{a.nome}</span>
                <span className="text-sm text-zinc-600">{kcalTexto(a)} · <Selo origem={a.origem} /></span>
              </button>
            ) : (
              <Link href={`/painel/alimentos/${a.id}`} className="flex items-center justify-between gap-2 p-2">
                <span>{a.nome}</span>
                <span className="text-sm text-zinc-600">{kcalTexto(a)} · <Selo origem={a.origem} /></span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Origem visível" (US-020): selo com texto, não só cor. */
export function Selo({ origem }: { origem: 'TACO' | 'Meu alimento' }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${origem === 'TACO' ? 'bg-zinc-100 text-zinc-800' : 'bg-emerald-100 text-emerald-900'}`}>{origem}</span>;
}
```

`src/app/painel/alimentos/page.tsx`:

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { FONTE_TACO_TEXTO } from '@/modules/alimentos/taco';
import { BuscaAlimento } from './busca-alimento';

export const dynamic = 'force-dynamic';

export default async function AlimentosPage() {
  await requireNutri('/painel/alimentos');
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Alimentos</h1>
        <Link href="/painel/alimentos/novo" className="rounded bg-emerald-700 px-4 py-2 text-white">Cadastrar meu alimento</Link>
      </div>
      <BuscaAlimento />
      <p className="text-sm text-zinc-600">Fonte: {FONTE_TACO_TEXTO}. Valores por 100 g.</p>
    </main>
  );
}
```

Em `src/app/painel/cabecalho.tsx`, depois de `Pacientes`: `<Link href="/painel/alimentos">Alimentos</Link>`.

- [ ] **Step 6: E2E** — `e2e/plano-alimentar.spec.ts` (arquivo novo; as Tarefas 4, 7–11 acrescentam testes a ele)

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.6.1');
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('busca tolerante a acento com selo de origem e fonte citada (US-020)', async () => {
  await nutri.goto('/painel/alimentos');
  await expect(nutri.getByText('Fonte: TACO 4ª ed. — NEPA/UNICAMP. Valores por 100 g.')).toBeVisible();
  await nutri.getByLabel('Buscar alimento').fill('feijao carioca');
  const opcao = nutri.getByRole('option', { name: /Feijão, carioca, cozido/ });
  await expect(opcao).toBeVisible();
  await expect(opcao).toContainText('76 kcal/100 g');
  await expect(opcao).toContainText('TACO');
  const posicao = await nutri.getByRole('option').evaluateAll((os) => os.findIndex((o) => o.textContent?.includes('Feijão, carioca, cozido')));
  expect(posicao).toBeLessThan(5);
});
```

(`sufixo` é usado pelos testes das próximas tarefas para nomes únicos.)

Run: `pnpm build && pnpm test:e2e e2e/plano-alimentar.spec.ts`
Expected: PASS.

- [ ] **Step 7: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/env.ts src/env.test.ts src/modules/alimentos/busca.ts src/modules/alimentos/busca.test.ts src/app/api/painel/alimentos \
  src/app/painel/alimentos src/app/painel/cabecalho.tsx test/nutri.ts e2e/plano-alimentar.spec.ts
git commit -m "feat(alimentos): busca sem acento em até 300 ms com selo TACO/Meu alimento, API e tela Alimentos (P04-03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Alimentos próprios — cadastrar, editar, excluir, "Duplicar como meu alimento" e medida caseira na tela (P04-04)

**Files:**
- Create: `src/modules/alimentos/alimentos-constantes.ts`, `src/modules/alimentos/alimentos.ts`, `src/modules/alimentos/alimentos.test.ts`, `src/lib/text.test.ts`, `src/app/painel/alimentos/actions.ts`, `src/app/painel/alimentos/alimento-form.tsx`, `src/app/painel/alimentos/medida-form.tsx`, `src/app/painel/alimentos/novo/page.tsx`, `src/app/painel/alimentos/[id]/page.tsx`, `src/app/painel/alimentos/[id]/excluir-alimento.tsx`, `src/app/painel/alimentos/[id]/editar/page.tsx`
- Modify: `src/lib/text.ts`, `src/db/errors.ts`, `src/modules/alimentos/medidas.ts`, `src/modules/pacientes/exames.ts`, `src/modules/pacientes/anamnese-tipos.ts`, `src/modules/pacientes/etiquetas.ts`, `e2e/plano-alimentar.spec.ts`

**Interfaces:**
- Consumes: `foods`, `GRUPOS_TACO`, `ehGrupo`, `FONTE_TACO_TEXTO` (Tarefa 1); `medidasDeVarios`, `cadastrarMedida`, `excluirMedida`, `MedidaError`, `MSG_MEDIDA` (Tarefa 2); `type Nutrientes100`, `Selo` (Tarefa 3); `decimalEntre`, `formatarDecimal`; `primeiroErroPorCampo`; `Campo`, `ConfirmarBotao`.
- Produces:
  - `@/lib/text`: `normalizarTexto(v: unknown): string` (trim + espaços repetidos → um).
  - `@/db/errors`: `fkViolation(err): string | null` (nome da constraint de FK violada, SQLSTATE 23503).
  - `@/modules/alimentos/alimentos-constantes`: `MSG_ALIMENTO`, `KCAL_MAX = 900`, `GRAMAS_MAX = 100`.
  - `@/modules/alimentos/alimentos`: `type AlimentoDetalhe = { id; nome; grupo; origem: 'TACO' | 'Meu alimento'; porCem: Nutrientes100; medidas: MedidaDisponivel[]; incompleto: boolean }`, `class AlimentoError { erros }`, `carregarAlimento(ctx, id, db?): Promise<AlimentoDetalhe | null>`, `criarAlimento(ctx, input, deps?): Promise<{ id: string }>`, `editarAlimento(ctx, id, input, deps?): Promise<void>`, `excluirAlimento(ctx, id, deps?): Promise<void>`, `duplicarComoMeu(ctx, id, deps?): Promise<{ id: string; incompleto: boolean }>`.

- [ ] **Step 1: `normalizarTexto` (item adiado do Plano 03)** — `src/lib/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizarTexto } from './text';

describe('normalizarTexto', () => {
  it('apara as pontas e junta espaços, tabs e quebras; não-texto vira vazio', () => {
    expect(normalizarTexto('  Pão \t low\n\ncarb  ')).toBe('Pão low carb');
    expect(normalizarTexto(null)).toBe('');
    expect(normalizarTexto(42)).toBe('');
  });
});
```

Em `src/lib/text.ts`, acrescentar:

```ts
/** Texto digitado: sem espaços nas pontas e com um espaço só entre palavras. Não-texto → ''. */
export const normalizarTexto = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
```

Trocar as cópias pelo helper (comportamento igual):
- `src/modules/pacientes/exames.ts`: `const texto = (v: unknown, max: number) => normalizarTexto(v).slice(0, max);` e `const passaDoLimite = (v: unknown, max: number) => normalizarTexto(v).length > max;`
- `src/modules/pacientes/anamnese-tipos.ts`: `const texto = normalizarTexto;`
- `src/modules/pacientes/etiquetas.ts`: `const nova = normalizarTexto(input.nova);`
- `src/modules/alimentos/medidas.ts` (Tarefa 2): remover `normalizar` e usar `normalizarTexto` no `schemaMedida`.
- Rode `grep -rn "replace(/\\\\s+/g, ' ')" src/modules` e troque qualquer outra cópia que aparecer (o Plano 03 citou também `atendimentos.ts`).

Run: `pnpm test src/lib/text.test.ts src/modules/pacientes src/modules/alimentos` → PASS (nada muda de comportamento).

- [ ] **Step 2: Testes (falham)** — `src/modules/alimentos/alimentos.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { MSG_ALIMENTO } from './alimentos-constantes';
import { AlimentoError, carregarAlimento, criarAlimento, duplicarComoMeu, editarAlimento, excluirAlimento } from './alimentos';
import { buscarAlimentos } from './busca';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AlimentoError) return e.erros;
    throw e;
  }
  throw new Error('esperava AlimentoError');
};

const PAO = { nome: 'Pão low carb Marca X', grupo: 'Cereais e derivados', kcal: '250', proteinaG: '12', carboidratoG: '8', lipidioG: '18', fibraG: '6' };

describe('alimentos próprios (US-021)', () => {
  it('"Cadastro": aparece nas minhas buscas com o selo "Meu alimento" e não aparece para nenhuma outra nutricionista', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { id } = await criarAlimento(A.ctx, PAO, deps);
    expect(await carregarAlimento(A.ctx, id, app.db)).toMatchObject({
      nome: 'Pão low carb Marca X', origem: 'Meu alimento', grupo: 'Cereais e derivados', incompleto: false,
      porCem: { kcal: 250, proteinaG: 12, carboidratoG: 8, lipidioG: 18, fibraG: 6 },
    });
    expect((await buscarAlimentos(A.ctx, 'pao low carb', app.db)).map((a) => [a.nome, a.origem])).toEqual([['Pão low carb Marca X', 'Meu alimento']]);
    expect(await buscarAlimentos(B.ctx, 'pao low carb', app.db)).toEqual([]);
    expect(await carregarAlimento(B.ctx, id, app.db)).toBeNull();
    await expect(editarAlimento(B.ctx, id, PAO, deps)).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.naoEncontrado } });
    await expect(excluirAlimento(B.ctx, id, deps)).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.naoEncontrado } });
  });

  it('validação: nome, grupo e valores por 100 g (vírgula aceita; lixo, negativo e acima do teto recusados)', async () => {
    const A = await novoTenant(app.db);
    expect(await erros(criarAlimento(A.ctx, { ...PAO, nome: ' x ', grupo: 'Doces', kcal: '901', proteinaG: '-1', carboidratoG: 'abc', lipidioG: '', fibraG: '100,5' }, deps))).toEqual({
      nome: MSG_ALIMENTO.nome,
      grupo: MSG_ALIMENTO.grupo,
      kcal: MSG_ALIMENTO.valores,
      proteinaG: MSG_ALIMENTO.valores,
      carboidratoG: MSG_ALIMENTO.valores,
      lipidioG: MSG_ALIMENTO.valores,
      fibraG: MSG_ALIMENTO.valores,
    });
    const { id } = await criarAlimento(A.ctx, { ...PAO, kcal: '250,5', fibraG: '0' }, deps);
    expect((await carregarAlimento(A.ctx, id, app.db))?.porCem).toMatchObject({ kcal: 250.5, fibraG: 0 });
  });

  it('"TACO não editável": editar ou excluir a TACO é recusado; "Duplicar como meu alimento" copia valores e medidas', async () => {
    const A = await novoTenant(app.db);
    expect(await erros(editarAlimento(A.ctx, idTaco(3), PAO, deps))).toEqual({ geral: MSG_ALIMENTO.taco });
    expect(await erros(excluirAlimento(A.ctx, idTaco(3), deps))).toEqual({ geral: MSG_ALIMENTO.taco });
    const copia = await duplicarComoMeu(A.ctx, idTaco(3), deps);
    expect(copia.incompleto).toBe(false);
    const d = await carregarAlimento(A.ctx, copia.id, app.db);
    expect(d).toMatchObject({ nome: 'Arroz, tipo 1, cozido', origem: 'Meu alimento', porCem: { kcal: 128, proteinaG: 2.5 } });
    expect(d?.medidas).toContainEqual({ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
    await editarAlimento(A.ctx, copia.id, { ...PAO, nome: 'Arroz da casa' }, deps);
    expect((await carregarAlimento(A.ctx, copia.id, app.db))?.nome).toBe('Arroz da casa');
    expect((await carregarAlimento(A.ctx, idTaco(3), app.db))?.nome).toBe('Arroz, tipo 1, cozido'); // a TACO não mudou
  });

  it('duplicar alimento da TACO sem valor (leite integral, "*") deixa 0 e marca como incompleto', async () => {
    const A = await novoTenant(app.db);
    const copia = await duplicarComoMeu(A.ctx, idTaco(458), deps);
    expect(copia.incompleto).toBe(true);
    expect((await carregarAlimento(A.ctx, copia.id, app.db))?.porCem).toEqual({ kcal: 0, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 });
    expect((await carregarAlimento(A.ctx, idTaco(458), app.db))?.incompleto).toBe(true);
  });

  it('excluir alimento próprio que não está em plano; id inválido é "não encontrado"', async () => {
    const A = await novoTenant(app.db);
    const { id } = await criarAlimento(A.ctx, PAO, deps);
    await excluirAlimento(A.ctx, id, deps);
    expect(await carregarAlimento(A.ctx, id, app.db)).toBeNull();
    expect(await carregarAlimento(A.ctx, 'abc', app.db)).toBeNull();
    expect(await erros(excluirAlimento(A.ctx, 'abc', deps))).toEqual({ geral: MSG_ALIMENTO.naoEncontrado });
  });
});
```

Run: `pnpm test src/modules/alimentos/alimentos.test.ts`
Expected: FAIL — `Cannot find module './alimentos-constantes'`.

- [ ] **Step 3: Implementar**

Em `src/db/errors.ts`, depois de `uniqueViolation`:

```ts
/** Nome da constraint de FK violada (Postgres 23503), olhando também o `cause` do erro do Drizzle. */
export function fkViolation(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === 'object' && i < 5; i++) {
    const pg = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === '23503') return typeof pg.constraint === 'string' ? pg.constraint : '';
    e = pg.cause;
  }
  return null;
}
```

`src/modules/alimentos/alimentos-constantes.ts`:

```ts
export const KCAL_MAX = 900;
export const GRAMAS_MAX = 100;

export const MSG_ALIMENTO = {
  nome: 'Informe o nome do alimento (2 a 120 caracteres)',
  grupo: 'Escolha o grupo do alimento',
  valores: 'Valores por 100 g: informe números entre 0 e 900',
  taco: 'Alimentos da TACO não podem ser alterados. Use "Duplicar como meu alimento".',
  emUso: 'Este alimento está em um plano e não pode ser excluído.',
  naoEncontrado: 'Alimento não encontrado.',
  incompleto: 'A TACO não tem todos os valores deste alimento: confira os campos com 0.',
} as const;
```

`src/modules/alimentos/alimentos.ts`:

```ts
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { fkViolation } from '@/db/errors';
import { foods } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { decimalEntre } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { GRAMAS_MAX, KCAL_MAX, MSG_ALIMENTO } from './alimentos-constantes';
import type { Nutrientes100 } from './busca';
import { ehGrupo } from './grupos';
import { medidasDeVarios, type MedidaDisponivel } from './medidas';

export type AlimentoDetalhe = {
  id: string;
  nome: string;
  grupo: string;
  origem: 'TACO' | 'Meu alimento';
  porCem: Nutrientes100;
  medidas: MedidaDisponivel[];
  /** Algum dos 5 valores principais está sem número (TACO "NA"/"*"). */
  incompleto: boolean;
};

export class AlimentoError extends Error {
  override name = 'AlimentoError';
  constructor(readonly erros: Record<string, string>) {
    super('Alimento inválido');
  }
}

const idValido = (id: unknown): id is string => typeof id === 'string' && z.guid().safeParse(id).success;
const gramas = decimalEntre(MSG_ALIMENTO.valores, 0, GRAMAS_MAX);
const schema = z.object({
  nome: z.unknown().transform(normalizarTexto).pipe(z.string().min(2, MSG_ALIMENTO.nome).max(120, MSG_ALIMENTO.nome)),
  grupo: z.unknown().refine(ehGrupo, MSG_ALIMENTO.grupo),
  kcal: decimalEntre(MSG_ALIMENTO.valores, 0, KCAL_MAX),
  proteinaG: gramas,
  carboidratoG: gramas,
  lipidioG: gramas,
  fibraG: gramas,
});
type EntradaAlimento = Record<keyof z.input<typeof schema>, unknown>;

function validar(input: EntradaAlimento) {
  const r = schema.safeParse(input);
  if (!r.success) throw new AlimentoError(primeiroErroPorCampo(r.error));
  return { ...r.data, grupo: r.data.grupo as string };
}

const porCem = (f: typeof foods.$inferSelect): Nutrientes100 => ({ kcal: f.kcal, proteinaG: f.proteinaG, carboidratoG: f.carboidratoG, lipidioG: f.lipidioG, fibraG: f.fibraG });
const incompleto = (n: Nutrientes100) => Object.values(n).some((v) => v === null);

export async function carregarAlimento(ctx: TenantContext, id: string, db: Db = getDb()): Promise<AlimentoDetalhe | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [f] = await tx.select().from(foods).where(eq(foods.id, id));
      if (!f) return null;
      const n = porCem(f);
      return { id: f.id, nome: f.nome, grupo: f.grupo, origem: f.tenantId === null ? 'TACO' : 'Meu alimento', porCem: n, medidas: (await medidasDeVarios(tx, [f.id])).get(f.id) ?? [], incompleto: incompleto(n) };
    },
    db,
  );
}

export async function criarAlimento(ctx: TenantContext, input: EntradaAlimento, deps: { db?: Db } = {}): Promise<{ id: string }> {
  const v = validar(input);
  const [f] = await withTenant(ctx, (tx) => tx.insert(foods).values({ tenantId: ctx.tenantId, ...v }).returning({ id: foods.id }), deps.db ?? getDb());
  return f;
}

/** Só o próprio tenant altera (RLS); a TACO dá "não pode ser alterada" (D1). */
async function exigirProprio(tx: Tx, id: string) {
  const [f] = await tx.select({ tenantId: foods.tenantId }).from(foods).where(eq(foods.id, id));
  if (!f) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  if (f.tenantId === null) throw new AlimentoError({ geral: MSG_ALIMENTO.taco });
}

export async function editarAlimento(ctx: TenantContext, id: string, input: EntradaAlimento, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  const v = validar(input);
  await withTenant(
    ctx,
    async (tx) => {
      await exigirProprio(tx, id);
      await tx.update(foods).set({ ...v, updatedAt: new Date() }).where(and(eq(foods.id, id), isNotNull(foods.tenantId)));
    },
    deps.db ?? getDb(),
  );
}

/** Review Focus 4: alimento usado em item de plano (FK RESTRICT de meal_items, Tarefa 6) não sai. */
export async function excluirAlimento(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  try {
    await withTenant(
      ctx,
      async (tx) => {
        await exigirProprio(tx, id);
        await tx.delete(foods).where(and(eq(foods.id, id), isNotNull(foods.tenantId)));
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (fkViolation(e)) throw new AlimentoError({ geral: MSG_ALIMENTO.emUso });
    throw e;
  }
}

/** US-021 "Duplicar como meu alimento": copia nome, grupo, valores (sem valor → 0) e medidas do seed. */
export async function duplicarComoMeu(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<{ id: string; incompleto: boolean }> {
  if (!idValido(id)) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  return withTenant(
    ctx,
    async (tx) => {
      const [f] = await tx.select().from(foods).where(eq(foods.id, id));
      if (!f) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
      const n = porCem(f);
      const [novo] = await tx
        .insert(foods)
        .values({
          tenantId: ctx.tenantId,
          nome: f.nome,
          grupo: f.grupo,
          kcal: n.kcal ?? 0,
          proteinaG: n.proteinaG ?? 0,
          carboidratoG: n.carboidratoG ?? 0,
          lipidioG: n.lipidioG ?? 0,
          fibraG: n.fibraG ?? 0,
          micros: f.micros,
          medidasCaseiras: f.medidasCaseiras,
          origemFoodId: f.id,
        })
        .returning({ id: foods.id });
      return { id: novo.id, incompleto: incompleto(n) };
    },
    deps.db ?? getDb(),
  );
}
```

Run: `pnpm test src/modules/alimentos/alimentos.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 4: Telas**

`src/app/painel/alimentos/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AlimentoError, criarAlimento, duplicarComoMeu, editarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { cadastrarMedida, excluirMedida, MedidaError } from '@/modules/alimentos/medidas';

export type AlimentoState = { erros?: Record<string, string>; valores?: Record<string, string> };
export type MedidaState = { erros?: Record<string, string>; ok?: string; envio?: number };

const campos = (fd: FormData) => ({
  nome: fd.get('nome'),
  grupo: fd.get('grupo'),
  kcal: fd.get('kcal'),
  proteinaG: fd.get('proteinaG'),
  carboidratoG: fd.get('carboidratoG'),
  lipidioG: fd.get('lipidioG'),
  fibraG: fd.get('fibraG'),
});
const valores = (fd: FormData) => Object.fromEntries(Object.entries(campos(fd)).map(([k, v]) => [k, typeof v === 'string' ? v : '']));

export async function criarAlimentoAction(_prev: AlimentoState, fd: FormData): Promise<AlimentoState> {
  const { ctx } = await requireNutri('/painel/alimentos/novo');
  let id: string;
  try {
    ({ id } = await criarAlimento(ctx, campos(fd)));
  } catch (e) {
    if (e instanceof AlimentoError) return { erros: e.erros, valores: valores(fd) };
    throw e;
  }
  redirect(`/painel/alimentos/${id}`);
}

export async function editarAlimentoAction(id: string, _prev: AlimentoState, fd: FormData): Promise<AlimentoState> {
  const { ctx } = await requireNutri(`/painel/alimentos/${id}/editar`);
  try {
    await editarAlimento(ctx, id, campos(fd));
  } catch (e) {
    if (e instanceof AlimentoError) return { erros: e.erros, valores: valores(fd) };
    throw e;
  }
  revalidatePath(`/painel/alimentos/${id}`);
  redirect(`/painel/alimentos/${id}`);
}

export async function excluirAlimentoAction(id: string, _prev: AlimentoState): Promise<AlimentoState> {
  const { ctx } = await requireNutri(`/painel/alimentos/${id}`);
  try {
    await excluirAlimento(ctx, id);
  } catch (e) {
    if (e instanceof AlimentoError) return { erros: e.erros };
    throw e;
  }
  redirect('/painel/alimentos');
}

export async function duplicarAlimentoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/alimentos/${id}`);
  let novo: { id: string; incompleto: boolean };
  try {
    novo = await duplicarComoMeu(ctx, id);
  } catch (e) {
    if (e instanceof AlimentoError) notFound();
    throw e;
  }
  redirect(`/painel/alimentos/${novo.id}/editar${novo.incompleto ? '?incompleto=1' : ''}`);
}

export async function cadastrarMedidaAction(foodId: string, _prev: MedidaState, fd: FormData): Promise<MedidaState> {
  const { ctx } = await requireNutri(`/painel/alimentos/${foodId}`);
  try {
    const m = await cadastrarMedida(ctx, foodId, { nome: fd.get('nome'), plural: fd.get('plural'), gramas: fd.get('gramas') });
    revalidatePath(`/painel/alimentos/${foodId}`);
    return { ok: `Medida "${m.nome}" cadastrada.`, envio: Date.now() };
  } catch (e) {
    if (e instanceof MedidaError) return { erros: e.erros };
    throw e;
  }
}

export async function excluirMedidaAction(foodId: string, medidaId: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/alimentos/${foodId}`);
  await excluirMedida(ctx, medidaId);
  revalidatePath(`/painel/alimentos/${foodId}`);
}
```

`src/app/painel/alimentos/alimento-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { GRUPOS_TACO } from '@/modules/alimentos/grupos';
import type { AlimentoState } from './actions';

type Valores = Record<'nome' | 'grupo' | 'kcal' | 'proteinaG' | 'carboidratoG' | 'lipidioG' | 'fibraG', string>;

export function AlimentoForm({ acao, inicial, rotuloBotao }: { acao: (s: AlimentoState, fd: FormData) => Promise<AlimentoState>; inicial: Valores; rotuloBotao: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  const e = state.erros ?? {};
  const v = { ...inicial, ...state.valores };
  const numero = (id: keyof Valores, rotulo: string) => <Campo id={id} rotulo={rotulo} inputMode="decimal" defaultValue={v[id]} erro={e[id]} />;
  return (
    <form action={action} className="space-y-4" noValidate>
      <Campo id="nome" rotulo="Nome" required defaultValue={v.nome} erro={e.nome} />
      <div className="space-y-1">
        <label htmlFor="grupo" className="block font-medium">Grupo</label>
        <select id="grupo" name="grupo" defaultValue={v.grupo} aria-invalid={e.grupo ? true : undefined} aria-describedby={e.grupo ? 'grupo-erro' : undefined} className="w-full rounded border p-2">
          <option value="">Escolha…</option>
          {GRUPOS_TACO.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        {e.grupo && <p id="grupo-erro" role="alert" className="text-sm text-red-700">{e.grupo}</p>}
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-5">
        <legend className="mb-1 font-medium">Valores por 100 g</legend>
        {numero('kcal', 'Energia (kcal)')}
        {numero('proteinaG', 'Proteína (g)')}
        {numero('carboidratoG', 'Carboidrato (g)')}
        {numero('lipidioG', 'Lipídio (g)')}
        {numero('fibraG', 'Fibra (g)')}
      </fieldset>
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{rotuloBotao}</button>
    </form>
  );
}
```

`src/app/painel/alimentos/medida-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import type { MedidaState } from './actions';

/** US-020 "Cadastrar medida caseira": grava em food_measures do tenant. */
export function MedidaForm({ acao }: { acao: (s: MedidaState, fd: FormData) => Promise<MedidaState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  const e = state.erros ?? {};
  return (
    <form key={state.envio} action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end" noValidate>
      <Campo id="medida-nome" name="nome" rotulo="Medida (singular)" placeholder="pires pequeno" erro={e.nome} />
      <Campo id="medida-plural" name="plural" rotulo="Plural" placeholder="pires pequenos" />
      <Campo id="medida-gramas" name="gramas" rotulo="Gramas" inputMode="decimal" erro={e.gramas} />
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Cadastrar medida caseira</button>
      {e.geral && <p role="alert" className="text-red-700 sm:col-span-4">{e.geral}</p>}
      {state.ok && <p role="status" className="text-emerald-800 sm:col-span-4">{state.ok}</p>}
    </form>
  );
}
```

`src/app/painel/alimentos/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { formatarDecimal } from '@/lib/numero';
import { requireNutri } from '@/lib/tenant-session';
import { carregarAlimento } from '@/modules/alimentos/alimentos';
import { FONTE_TACO_TEXTO } from '@/modules/alimentos/taco';
import { cadastrarMedidaAction, duplicarAlimentoAction, excluirAlimentoAction, excluirMedidaAction } from '../actions';
import { Selo } from '../busca-alimento';
import { ExcluirAlimento } from './excluir-alimento';
import { MedidaForm } from '../medida-form';

export const dynamic = 'force-dynamic';

const valor = (v: number | null, casas: number, unidade: string) => (v === null ? 'Sem valor na TACO' : `${formatarDecimal(v, casas)} ${unidade}`);

export default async function AlimentoPage({ params }: PageProps<'/painel/alimentos/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/alimentos/${id}`);
  const a = await carregarAlimento(ctx, id);
  if (!a) notFound();
  const taco = a.origem === 'TACO';
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link href="/painel/alimentos" className="text-sm underline">Voltar</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{a.nome}</h1>
        <Selo origem={a.origem} />
      </div>
      <p className="text-sm text-zinc-600">{a.grupo}</p>
      <table className="w-full text-left">
        <caption className="sr-only">Valores por 100 g</caption>
        <tbody>
          <tr><th scope="row">Energia</th><td>{valor(a.porCem.kcal, 0, 'kcal')}</td></tr>
          <tr><th scope="row">Proteína</th><td>{valor(a.porCem.proteinaG, 1, 'g')}</td></tr>
          <tr><th scope="row">Carboidrato</th><td>{valor(a.porCem.carboidratoG, 1, 'g')}</td></tr>
          <tr><th scope="row">Lipídio</th><td>{valor(a.porCem.lipidioG, 1, 'g')}</td></tr>
          <tr><th scope="row">Fibra</th><td>{valor(a.porCem.fibraG, 1, 'g')}</td></tr>
        </tbody>
      </table>
      {taco ? (
        <div className="space-y-2">
          <form action={duplicarAlimentoAction.bind(null, a.id)}>
            <button className="rounded bg-emerald-700 px-4 py-2 text-white">Duplicar como meu alimento</button>
          </form>
          <p className="text-sm text-zinc-600">Fonte: {FONTE_TACO_TEXTO}.</p>
        </div>
      ) : (
        <div className="flex gap-4">
          <Link href={`/painel/alimentos/${a.id}/editar`} className="underline">Editar</Link>
          <ExcluirAlimento acao={excluirAlimentoAction.bind(null, a.id)} />
        </div>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Medidas caseiras</h2>
        {a.medidas.length === 0 ? (
          <p>Sem medida caseira: no plano, informe a quantidade em gramas ou cadastre uma medida abaixo.</p>
        ) : (
          <ul className="space-y-1">
            {a.medidas.map((m) => (
              <li key={`${m.origem}-${m.id ?? m.nome}`} className="flex items-center gap-3">
                <span>{m.nome} — {formatarDecimal(m.gramas, m.gramas % 1 ? 1 : 0)} g</span>
                <span className="text-xs text-zinc-600">{m.origem}</span>
                {m.id && (
                  <form action={excluirMedidaAction.bind(null, a.id, m.id)}>
                    <ConfirmarBotao mensagem={`Excluir a medida "${m.nome}"?`} rotulo={`Excluir a medida ${m.nome}`}>Excluir</ConfirmarBotao>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <MedidaForm acao={cadastrarMedidaAction.bind(null, a.id)} />
      </section>
    </main>
  );
}
```

`src/app/painel/alimentos/[id]/excluir-alimento.tsx` (o erro "Este alimento está em um plano…" precisa voltar para a tela):

```tsx
'use client';

import { useActionState } from 'react';
import type { AlimentoState } from '../actions';

export function ExcluirAlimento({ acao }: { acao: (s: AlimentoState) => Promise<AlimentoState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm('Excluir este alimento?')) e.preventDefault(); }}>
      <button disabled={pendente} className="underline">Excluir</button>
      {state.erros?.geral && <p role="alert" className="text-sm text-red-700">{state.erros.geral}</p>}
    </form>
  );
}
```

`src/app/painel/alimentos/novo/page.tsx`:

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { criarAlimentoAction } from '../actions';
import { AlimentoForm } from '../alimento-form';

export const dynamic = 'force-dynamic';

export default async function NovoAlimentoPage() {
  await requireNutri('/painel/alimentos/novo');
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href="/painel/alimentos" className="text-sm underline">Voltar</Link>
      <h1 className="text-2xl font-semibold">Cadastrar meu alimento</h1>
      <AlimentoForm acao={criarAlimentoAction} inicial={{ nome: '', grupo: '', kcal: '', proteinaG: '', carboidratoG: '', lipidioG: '', fibraG: '' }} rotuloBotao="Salvar alimento" />
    </main>
  );
}
```

`src/app/painel/alimentos/[id]/editar/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatarDecimal } from '@/lib/numero';
import { requireNutri } from '@/lib/tenant-session';
import { carregarAlimento } from '@/modules/alimentos/alimentos';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { editarAlimentoAction } from '../../actions';
import { AlimentoForm } from '../../alimento-form';

export const dynamic = 'force-dynamic';

const txt = (v: number | null) => (v === null ? '' : formatarDecimal(v, v % 1 ? 2 : 0));

export default async function EditarAlimentoPage({ params, searchParams }: PageProps<'/painel/alimentos/[id]/editar'>) {
  const { id } = await params;
  const { incompleto } = await searchParams;
  const { ctx } = await requireNutri(`/painel/alimentos/${id}/editar`);
  const a = await carregarAlimento(ctx, id);
  if (!a || a.origem === 'TACO') notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href={`/painel/alimentos/${a.id}`} className="text-sm underline">Voltar</Link>
      <h1 className="text-2xl font-semibold">Editar meu alimento</h1>
      {incompleto === '1' && <p role="status" className="rounded bg-amber-50 p-3">{MSG_ALIMENTO.incompleto}</p>}
      <AlimentoForm
        acao={editarAlimentoAction.bind(null, a.id)}
        inicial={{ nome: a.nome, grupo: a.grupo, kcal: txt(a.porCem.kcal), proteinaG: txt(a.porCem.proteinaG), carboidratoG: txt(a.porCem.carboidratoG), lipidioG: txt(a.porCem.lipidioG), fibraG: txt(a.porCem.fibraG) }}
        rotuloBotao="Salvar alterações"
      />
    </main>
  );
}
```

O `Campo` usa `id` como `name`; no `MedidaForm` os ids são `medida-*` para não colidir com o formulário do alimento, então o `name` é passado explicitamente (o `{...input}` do `Campo` sobrescreve o `name` padrão).

- [ ] **Step 5: E2E** — acrescentar a `e2e/plano-alimentar.spec.ts`:

```ts
test('meu alimento: cadastro com selo, TACO só com "Duplicar como meu alimento", medida caseira (US-021, US-020)', async () => {
  await nutri.goto('/painel/alimentos/novo');
  await nutri.getByLabel('Nome').fill(`Pão low carb ${sufixo}`);
  await nutri.getByLabel('Grupo').selectOption('Cereais e derivados');
  await nutri.getByLabel('Energia (kcal)').fill('250');
  await nutri.getByLabel('Proteína (g)').fill('12');
  await nutri.getByLabel('Carboidrato (g)').fill('8');
  await nutri.getByLabel('Lipídio (g)').fill('18');
  await nutri.getByLabel('Fibra (g)').fill('6');
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByRole('heading', { name: `Pão low carb ${sufixo}` })).toBeVisible();
  await expect(nutri.getByText('Meu alimento', { exact: true })).toBeVisible();

  await nutri.goto('/painel/alimentos/00000000-0000-4000-8000-000000000112'); // Chuchu, cozido (TACO, sem medida)
  await expect(nutri.getByRole('button', { name: 'Duplicar como meu alimento' })).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Editar' })).toHaveCount(0);
  await expect(nutri.getByText('Sem medida caseira')).toBeVisible();
  await nutri.getByLabel('Medida (singular)').fill('pires pequeno');
  await nutri.getByLabel('Plural').fill('pires pequenos');
  await nutri.getByLabel('Gramas').fill('60');
  await nutri.getByRole('button', { name: 'Cadastrar medida caseira' }).click();
  await expect(nutri.getByRole('status')).toHaveText('Medida "pires pequeno" cadastrada.');
  await expect(nutri.getByText('pires pequeno — 60 g')).toBeVisible();
});
```

Run: `pnpm build && pnpm test:e2e e2e/plano-alimentar.spec.ts` → PASS.

- [ ] **Step 6: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/lib/text.ts src/lib/text.test.ts src/db/errors.ts src/modules/alimentos src/modules/pacientes src/app/painel/alimentos e2e/plano-alimentar.spec.ts
git commit -m "feat(alimentos): meus alimentos, \"Duplicar como meu alimento\" e cadastro de medida caseira na tela (P04-04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cálculo do plano (RN-02) — função pura compartilhada por editor, servidor e PDF (P04-05a)

**Files:**
- Create: `src/modules/plano-alimentar/constantes.ts`, `src/modules/plano-alimentar/calculo.ts`, `src/modules/plano-alimentar/calculo.test.ts`

**Interfaces:**
- Consumes: `type Nutrientes100` (Tarefa 3, só tipo); `lerDecimal`, `arredondar`, `formatarDecimal`, `casasDecimais` (`@/lib/numero`).
- Produces:
  - `@/modules/plano-alimentar/constantes` (sem banco; o cliente importa): `MSG_PLANO`, `QUANTIDADE_MIN = 0.1`, `QUANTIDADE_MAX = 5000`, `META_MIN = 500`, `META_MAX = 10000`, `MAX_REFEICOES = 15`, `MAX_ITENS = 200`, `MAX_TEXTO = 2000`.
  - `@/modules/plano-alimentar/calculo`: `type Nutrientes = { kcal; proteinaG; carboidratoG; lipidioG; fibraG }` (números), `type ItemCalculo = { id: string; quantidadeG: number | null; porCem: Nutrientes100; substituiItemId: string | null }`, `ZERO`, `lerQuantidade(v: unknown): number | null`, `nutrientesDoItem(porCem, gramas): Nutrientes & { semValor: (keyof Nutrientes)[] }`, `totalDosItens(itens: ItemCalculo[]): Nutrientes`, `totalDoDia(refeicoes: { itens: ItemCalculo[] }[]): Nutrientes`, `type Faixa = 'verde' | 'amarelo' | 'vermelho'`, `indicadorMeta(kcal: number, meta: number | null): { faixa: Faixa; desvio: number; rotulo: string; texto: string } | null`, `distribuicaoMacros(total: Nutrientes, pesoKg: number | null)`, `diferencaKcal(sub: number, principal: number): string`, `kcalTexto(n: number): string`, `gTexto(n: number): string`.

- [ ] **Step 1: Constantes** — `src/modules/plano-alimentar/constantes.ts`

```ts
export const QUANTIDADE_MIN = 0.1;
export const QUANTIDADE_MAX = 5000;
export const META_MIN = 500;
export const META_MAX = 10000;
export const MAX_REFEICOES = 15;
export const MAX_ITENS = 200;
export const MAX_TEXTO = 2000;

export const MSG_PLANO = {
  quantidade: 'Quantidade deve estar entre 0,1 e 5000 g',
  meta: 'Meta deve estar entre 500 e 10000 kcal',
  calculo: 'Cálculo de gasto energético não encontrado.',
  titulo: 'Informe o título do plano (até 120 caracteres)',
  refeicaoNome: 'Informe o nome da refeição (até 60 caracteres)',
  horario: 'Horário inválido (use HH:MM)',
  alimento: 'Alimento não encontrado.',
  substituicao: 'A substituição precisa estar ligada a um alimento principal da mesma refeição.',
  limite: 'O plano pode ter até 15 refeições e 200 itens.',
  texto: 'Texto muito longo (até 2000 caracteres).',
  conflito: 'Este plano foi alterado em outra aba. Recarregue a página para continuar.',
  invalido: 'Não foi possível salvar estes dados. Recarregue a página.',
  naoEncontrado: 'Plano não encontrado.',
  naoEditavel: 'Este plano já foi publicado e não pode ser alterado. Use "Editar" para criar uma nova versão.',
  rascunhoExiste: 'Já existe um rascunho para este paciente.',
  publicarVazio: 'Inclua pelo menos uma refeição com um alimento para publicar.',
  publicarHorario: 'Informe o horário de todas as refeições.',
  publicarRefeicaoVazia: (nome: string) => `A refeição "${nome}" não tem alimentos.`,
  semValor: 'Sem valor na TACO',
  semPeso: 'Registre a antropometria para ver g/kg',
} as const;
```

- [ ] **Step 2: Testes (falham)** — `src/modules/plano-alimentar/calculo.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { diferencaKcal, distribuicaoMacros, gTexto, indicadorMeta, kcalTexto, lerQuantidade, nutrientesDoItem, totalDoDia, totalDosItens, type ItemCalculo } from './calculo';

const porCem = (kcal: number | null, p = 0, c = 0, l = 0, f = 0) => ({ kcal, proteinaG: p, carboidratoG: c, lipidioG: l, fibraG: f });
const item = (id: string, g: number | null, pc = porCem(100), sub: string | null = null): ItemCalculo => ({ id, quantidadeG: g, porCem: pc, substituiItemId: sub });

describe('RN-02: nutriente do item = valor por 100 g × gramas / 100', () => {
  it('"Cálculo do item": 130 kcal/100 g × 150 g = 195 kcal', () => {
    expect(nutrientesDoItem(porCem(130, 2, 28, 0.5, 1.6), 150)).toEqual({ kcal: 195, proteinaG: 3, carboidratoG: 42, lipidioG: 0.75, fibraG: 2.4, semValor: [] });
  });

  it('Review Focus 3: nutriente sem valor na TACO conta 0 e é apontado, nunca NaN', () => {
    const leite = { kcal: null, proteinaG: null, carboidratoG: 4.6, lipidioG: null, fibraG: null };
    const n = nutrientesDoItem(leite, 200);
    expect(n).toEqual({ kcal: 0, proteinaG: 0, carboidratoG: 9.2, lipidioG: 0, fibraG: 0, semValor: ['kcal', 'proteinaG', 'lipidioG', 'fibraG'] });
    expect(Number.isNaN(totalDosItens([item('a', 200, leite)]).kcal)).toBe(false);
  });

  it('totais contam só itens principais com quantidade válida (substituições e quantidade inválida ficam fora)', () => {
    const itens = [item('pao', 50, porCem(300)), item('tapioca', 40, porCem(240), 'pao'), item('queijo', null, porCem(264)), item('cafe', 100, porCem(9))];
    expect(totalDosItens(itens).kcal).toBe(159); // 150 (pão) + 9 (café)
    expect(totalDoDia([{ itens }, { itens: [item('arroz', 100, porCem(128))] }]).kcal).toBe(287);
  });

  it('Review Focus 2: quantidade digitada — vírgula e ponto valem; lixo, zero, negativo e acima de 5000 g não', () => {
    expect(lerQuantidade('1,5')).toBe(1.5);
    expect(lerQuantidade(' 150 ')).toBe(150);
    expect(lerQuantidade(150)).toBe(150);
    for (const v of ['abc', '0', '-10', '99999', '', null, '0,05', '1.2.3']) expect(lerQuantidade(v), String(v)).toBeNull();
  });
});

describe('RN-02: indicador × meta_kcal', () => {
  it('"Indicador de meta": 2080 verde (4%), 2150 amarelo (7,5%), 2300 vermelho (15%)', () => {
    expect(indicadorMeta(2080, 2000)).toEqual({ faixa: 'verde', desvio: 0.04, rotulo: 'Dentro da meta', texto: '+4%' });
    expect(indicadorMeta(2150, 2000)).toEqual({ faixa: 'amarelo', desvio: 0.075, rotulo: 'Atenção', texto: '+7,5%' });
    expect(indicadorMeta(2300, 2000)).toEqual({ faixa: 'vermelho', desvio: 0.15, rotulo: 'Fora da meta', texto: '+15%' });
  });

  it('limites exatos (5% é verde, 10% é amarelo), abaixo da meta e sem meta', () => {
    expect(indicadorMeta(2100, 2000)?.faixa).toBe('verde');
    expect(indicadorMeta(1800, 2000)).toMatchObject({ faixa: 'amarelo', texto: '−10%' });
    expect(indicadorMeta(1799, 2000)?.faixa).toBe('vermelho');
    expect(indicadorMeta(1500, null)).toBeNull();
    expect(indicadorMeta(0, 2000)).toMatchObject({ faixa: 'vermelho', texto: '−100%' });
  });
});

describe('distribuição de macros e exibição', () => {
  it('"Distribuição de macros": g, g/kg e % do VET (4/4/9 kcal por g) e fibra total', () => {
    const total = { kcal: 2000, proteinaG: 100, carboidratoG: 250, lipidioG: 66.7, fibraG: 28 };
    expect(distribuicaoMacros(total, 80)).toEqual({
      proteina: { g: 100, gPorKg: 1.25, pctVet: 20 },
      carboidrato: { g: 250, gPorKg: 3.125, pctVet: 50 },
      lipidio: { g: 66.7, gPorKg: 0.83375, pctVet: 30.015 },
      fibraG: 28,
    });
  });

  it('sem peso, g/kg é null; sem kcal, % do VET é null', () => {
    const d = distribuicaoMacros({ kcal: 0, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 }, null);
    expect(d.proteina).toEqual({ g: 0, gPorKg: null, pctVet: null });
  });

  it('diferença da substituição e arredondamento de exibição (kcal inteiro, gramas com 1 casa)', () => {
    expect(diferencaKcal(162.4, 150)).toBe('+12 kcal');
    expect(diferencaKcal(140, 150)).toBe('−10 kcal');
    expect(diferencaKcal(150.2, 150)).toBe('0 kcal');
    expect(kcalTexto(194.5)).toBe('195');
    expect(gTexto(0.75)).toBe('0,8');
  });

  it('recalcular 6 refeições × 40 itens leva bem menos de 100 ms (RNF-01)', () => {
    const refeicoes = Array.from({ length: 6 }, (_, r) => ({ itens: Array.from({ length: 7 }, (_, i) => item(`${r}-${i}`, 100 + i, porCem(100 + i, 5, 10, 3, 1))) }));
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) totalDoDia(refeicoes);
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/calculo.test.ts`
Expected: FAIL — `Cannot find module './calculo'`.

- [ ] **Step 3: Implementar** — `src/modules/plano-alimentar/calculo.ts`

```ts
import { arredondar, casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { QUANTIDADE_MAX, QUANTIDADE_MIN } from './constantes';

/** RN-02. Sem banco e sem React: o editor (cliente), o servidor e o PDF usam a mesma conta. */
export type Nutrientes = { kcal: number; proteinaG: number; carboidratoG: number; lipidioG: number; fibraG: number };
export type ItemCalculo = { id: string; quantidadeG: number | null; porCem: Nutrientes100; substituiItemId: string | null };

const CAMPOS = ['kcal', 'proteinaG', 'carboidratoG', 'lipidioG', 'fibraG'] as const;
export const ZERO: Nutrientes = { kcal: 0, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 };

/** Gramas digitados ("150", "1,5") dentro de [0,1; 5000]; qualquer outra coisa → null (Review Focus 2). */
export function lerQuantidade(v: unknown): number | null {
  const n = lerDecimal(v);
  if (n === null || Number.isNaN(n) || n < QUANTIDADE_MIN || n > QUANTIDADE_MAX) return null;
  return n;
}

/** valor_por_100g × gramas / 100; sem valor na TACO conta 0 e vai para `semValor` (Review Focus 3). */
export function nutrientesDoItem(porCem: Nutrientes100, gramas: number): Nutrientes & { semValor: (keyof Nutrientes)[] } {
  const semValor: (keyof Nutrientes)[] = [];
  const out = { ...ZERO };
  for (const c of CAMPOS) {
    const v = porCem[c];
    if (v === null) semValor.push(c);
    else out[c] = arredondar((v * gramas) / 100, 6);
  }
  return { ...out, semValor };
}

const somar = (a: Nutrientes, b: Nutrientes): Nutrientes => ({
  kcal: arredondar(a.kcal + b.kcal, 6),
  proteinaG: arredondar(a.proteinaG + b.proteinaG, 6),
  carboidratoG: arredondar(a.carboidratoG + b.carboidratoG, 6),
  lipidioG: arredondar(a.lipidioG + b.lipidioG, 6),
  fibraG: arredondar(a.fibraG + b.fibraG, 6),
});

/** Só itens principais (substituiItemId nulo) com quantidade válida (RN-02). */
export function totalDosItens(itens: ItemCalculo[]): Nutrientes {
  let t = ZERO;
  for (const i of itens) {
    if (i.substituiItemId !== null || i.quantidadeG === null) continue;
    const { semValor: _, ...n } = nutrientesDoItem(i.porCem, i.quantidadeG);
    t = somar(t, n);
  }
  return t;
}

export const totalDoDia = (refeicoes: { itens: ItemCalculo[] }[]): Nutrientes => refeicoes.reduce((t, r) => somar(t, totalDosItens(r.itens)), ZERO);

export type Faixa = 'verde' | 'amarelo' | 'vermelho';
const ROTULO: Record<Faixa, string> = { verde: 'Dentro da meta', amarelo: 'Atenção', vermelho: 'Fora da meta' };

const sinal = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

/** RN-02: |desvio| ≤ 5% verde; ≤ 10% amarelo; > 10% vermelho. Texto com sinal e até 1 casa ("+7,5%"). */
export function indicadorMeta(kcal: number, meta: number | null): { faixa: Faixa; desvio: number; rotulo: string; texto: string } | null {
  if (meta === null || !(meta > 0)) return null;
  const desvio = arredondar((kcal - meta) / meta, 6);
  const abs = Math.abs(desvio);
  const faixa: Faixa = abs <= 0.05 ? 'verde' : abs <= 0.1 ? 'amarelo' : 'vermelho';
  const pct = arredondar(abs * 100, 1);
  return { faixa, desvio, rotulo: ROTULO[faixa], texto: `${sinal(desvio)}${formatarDecimal(pct, casasDecimais(pct))}%` };
}

type Macro = { g: number; gPorKg: number | null; pctVet: number | null };

/** US-022 "Distribuição de macros": g, g/kg (peso da última antropometria) e % do VET (4/4/9 kcal/g). */
export function distribuicaoMacros(total: Nutrientes, pesoKg: number | null): { proteina: Macro; carboidrato: Macro; lipidio: Macro; fibraG: number } {
  const macro = (g: number, kcalPorG: number): Macro => ({
    g,
    gPorKg: pesoKg && pesoKg > 0 ? arredondar(g / pesoKg, 6) : null,
    pctVet: total.kcal > 0 ? arredondar(((g * kcalPorG) / total.kcal) * 100, 6) : null,
  });
  return { proteina: macro(total.proteinaG, 4), carboidrato: macro(total.carboidratoG, 4), lipidio: macro(total.lipidioG, 9), fibraG: total.fibraG };
}

/** Exibição (RN-02): kcal inteiro; gramas com 1 casa. */
export const kcalTexto = (n: number): string => formatarDecimal(n, 0);
export const gTexto = (n: number): string => formatarDecimal(n, 1);

/** US-023: "+12 kcal" (substituição × principal), com os dois já arredondados como aparecem na tela. */
export function diferencaKcal(sub: number, principal: number): string {
  const d = arredondar(sub, 0) - arredondar(principal, 0);
  return `${sinal(d)}${Math.abs(d)} kcal`;
}
```

Run: `pnpm test src/modules/plano-alimentar/calculo.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 4: Commit**

Run: `pnpm lint && pnpm typecheck`
Expected: verde.

```bash
git add src/modules/plano-alimentar
git commit -m "feat(plano-alimentar): cálculo RN-02 puro — itens, totais só de principais, meta por faixas, macros em g, g/kg e % do VET (P04-05a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tabelas do plano, rascunho com salvamento por diferença e trava de revisão, API (P04-05b)

**Files:**
- Create: `src/db/schema/plano-alimentar.ts`, `drizzle/0044_planos_alimentares.sql` (gerada), `drizzle/0045_rls_planos_alimentares.sql` (custom), `src/modules/plano-alimentar/tipos.ts`, `src/modules/plano-alimentar/erros.ts`, `src/modules/plano-alimentar/carregar.ts`, `src/modules/plano-alimentar/rascunho.ts`, `src/modules/plano-alimentar/rascunho.test.ts`, `src/app/api/painel/planos/[id]/route.ts`, `src/app/api/painel/planos/[id]/route.test.ts`
- Modify: `src/db/schema/index.ts`, `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts`, `src/modules/pacientes/exportacao-job.ts`, `src/modules/pacientes/exportacao.test.ts`

**Interfaces:**
- Consumes: `foods`, `type MedidaCaseira` (Tarefa 1); `medidasDeVarios`, `type MedidaDisponivel`, `textoMedida`, `gramasDaMedida`, `QTD_MEDIDA_MAX` (Tarefa 2); `type Nutrientes100` (Tarefa 3); `normalizarTexto` (Tarefa 4); `lerQuantidade`, `MSG_PLANO`, `META_MIN`, `META_MAX`, `MAX_*` (Tarefa 5); `carregarPacienteParaEscrita`, `PacienteNaoEncontradoError`, `PacienteBloqueadoError`, `idValido` (`@/modules/pacientes/base`); `patients`, `storedFiles`, `tenants`; `auditRead`; `uniqueViolation`; `requireApiNutri`; `nutriComDpa` (Tarefa 3).
- Produces:
  - Schema: `mealPlans` 🔒, `meals` 🔒, `mealItems` 🔒, `type MealPlanRow`, `type MedidaDoItem = { nome: string; plural: string; gramas: number; qtd: number }`, `type NutrientesCongelados = Nutrientes100 & { nome: string; origem: 'TACO' | 'Meu alimento' }`.
  - `@/modules/plano-alimentar/tipos` (sem banco): `type StatusPlano`, `type ItemPlano`, `type RefeicaoPlano`, `type PlanoCompleto`, `type RascunhoEnviado`.
  - `@/modules/plano-alimentar/erros`: `PlanoNaoEncontradoError`, `PlanoNaoEditavelError`, `ConflitoRevisaoError`, `class PlanoError { erros: Record<string, string> }` (chaves: `titulo`, `metaKcal`, `orientacoes`, `geral`, `refeicao:<id>:nome`, `refeicao:<id>:horario`, `refeicao:<id>:observacao`, `item:<id>:quantidadeG`, `item:<id>:foodId`, `item:<id>:substituiItemId`, `item:<id>:medida`).
  - `@/modules/plano-alimentar/carregar`: `carregarPlano(ctx, planId, db?): Promise<PlanoCompleto | null>` (audita leitura de plano de paciente), `lerPlanoNaTransacao(tx, planId, opts?: { auditar?: boolean }): Promise<PlanoCompleto | null>`.
  - `@/modules/plano-alimentar/rascunho`: `criarRascunho(ctx, patientId, deps?): Promise<{ id: string; criado: boolean }>`, `salvarRascunho(ctx, planId, entrada: unknown, deps?): Promise<{ revisao: number }>`, `descartarRascunho(ctx, planId, deps?): Promise<void>`, `proximaVersao(tx, patientId): Promise<number>`, `copiarConteudo(tx, origemId, destino: { id; patientId: string | null }): Promise<void>` (Tarefas 9 e 10).
  - `GET`/`PUT /api/painel/planos/[id]`: `PUT` com o `RascunhoEnviado` → `200 { revisao }` · `422 { erros }` · `409 { erro }` (revisão velha, plano publicado, paciente bloqueado) · `404 { erro }` · `413`.

- [ ] **Step 1: Tabelas** — `src/db/schema/plano-alimentar.ts`

```ts
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, smallint, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { foods } from './alimentos';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

export type MedidaDoItem = { nome: string; plural: string; gramas: number; qtd: number };
/** D10: cópia dos valores por 100 g e do nome no momento da publicação (plano publicado é imutável, RN-01). */
export type NutrientesCongelados = {
  nome: string;
  origem: 'TACO' | 'Meu alimento';
  kcal: number | null;
  proteinaG: number | null;
  carboidratoG: number | null;
  lipidioG: number | null;
  fibraG: number | null;
};

/** US-022–026, RN-01. `patient_id` nulo = modelo (US-024). */
export const mealPlans = pgTable(
  'meal_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id'),
    isTemplate: boolean('is_template').notNull().default(false),
    titulo: text('titulo').notNull(),
    metaKcal: integer('meta_kcal'),
    /** Cálculo de gasto energético de onde veio a meta (referência sem FK; ver desvios). */
    energyCalcId: uuid('energy_calc_id'),
    status: text('status').notNull().default('rascunho'),
    versao: integer('versao').notNull().default(1),
    /** D7: trava otimista do salvamento automático. */
    revisao: integer('revisao').notNull().default(0),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
    origemPlanId: uuid('origem_plan_id'),
    mostrarCalorias: boolean('mostrar_calorias').notNull().default(false),
    orientacoes: text('orientacoes').notNull().default(''),
    pdfPath: text('pdf_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    pdfStatus: text('pdf_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('meal_plans_status_valido', sql`${t.status} in ('rascunho', 'publicado', 'arquivado')`),
    check('meal_plans_modelo_sem_paciente', sql`${t.isTemplate} = (${t.patientId} is null)`),
    check('meal_plans_modelo_rascunho', sql`not ${t.isTemplate} or ${t.status} = 'rascunho'`),
    check('meal_plans_versao_valida', sql`${t.versao} >= 1`),
    check('meal_plans_meta_faixa', sql`${t.metaKcal} is null or ${t.metaKcal} between 500 and 10000`),
    check('meal_plans_pdf_status_valido', sql`${t.pdfStatus} is null or ${t.pdfStatus} in ('pendente', 'pronto', 'falhou')`),
    check('meal_plans_pdf_do_tenant', sql`${t.pdfPath} is null or ${t.pdfPath} like ${t.tenantId}::text || '/plano_pdf/%'`),
    check('meal_plans_textos_tamanho', sql`char_length(${t.titulo}) between 1 and 120 and char_length(${t.orientacoes}) <= 2000`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'meal_plans_paciente_fk' }),
    unique('meal_plans_tenant_id_unique').on(t.tenantId, t.id),
    unique('meal_plans_tenant_id_paciente_unique').on(t.tenantId, t.id, t.patientId),
    // RN-01: no máximo 1 publicado por paciente; D11: no máximo 1 rascunho por paciente
    uniqueIndex('meal_plans_um_publicado_idx').on(t.tenantId, t.patientId).where(sql`${t.status} = 'publicado'`),
    uniqueIndex('meal_plans_um_rascunho_idx').on(t.tenantId, t.patientId).where(sql`${t.status} = 'rascunho' and ${t.patientId} is not null`),
    index('meal_plans_paciente_idx').on(t.tenantId, t.patientId, t.versao),
  ],
);

export type MealPlanRow = typeof mealPlans.$inferSelect;

export const meals = pgTable(
  'meals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id'),
    planId: uuid('plan_id').notNull(),
    nome: text('nome').notNull(),
    horario: time('horario'),
    ordem: smallint('ordem').notNull(),
    observacao: text('observacao').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('meals_textos_tamanho', sql`char_length(${t.nome}) between 1 and 60 and char_length(${t.observacao}) <= 2000`),
    foreignKey({ columns: [t.tenantId, t.planId], foreignColumns: [mealPlans.tenantId, mealPlans.id], name: 'meals_plano_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.planId, t.patientId], foreignColumns: [mealPlans.tenantId, mealPlans.id, mealPlans.patientId], name: 'meals_plano_paciente_fk' }).onDelete('cascade'),
    unique('meals_tenant_plano_id_unique').on(t.tenantId, t.planId, t.id),
    index('meals_plano_idx').on(t.tenantId, t.planId, t.ordem),
  ],
);

export const mealItems = pgTable(
  'meal_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id'),
    planId: uuid('plan_id').notNull(),
    mealId: uuid('meal_id').notNull(),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
    quantidadeG: numeric('quantidade_g', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    medida: jsonb('medida').$type<MedidaDoItem>(),
    medidaCaseiraTxt: text('medida_caseira_txt'),
    /** D9: item principal que esta substituição troca (mesma refeição). Nulo = item principal. */
    substituiItemId: uuid('substitui_item_id'),
    ordem: smallint('ordem').notNull(),
    nutrientes: jsonb('nutrientes').$type<NutrientesCongelados>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('meal_items_quantidade_faixa', sql`${t.quantidadeG} between 0.1 and 5000`),
    check('meal_items_nao_substitui_a_si', sql`${t.substituiItemId} is null or ${t.substituiItemId} <> ${t.id}`),
    foreignKey({ columns: [t.tenantId, t.planId, t.mealId], foreignColumns: [meals.tenantId, meals.planId, meals.id], name: 'meal_items_refeicao_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.planId, t.patientId], foreignColumns: [mealPlans.tenantId, mealPlans.id, mealPlans.patientId], name: 'meal_items_plano_paciente_fk' }).onDelete('cascade'),
    unique('meal_items_tenant_refeicao_id_unique').on(t.tenantId, t.mealId, t.id),
    foreignKey({ columns: [t.tenantId, t.mealId, t.substituiItemId], foreignColumns: [t.tenantId, t.mealId, t.id], name: 'meal_items_principal_fk' }).onDelete('cascade'),
    index('meal_items_refeicao_idx').on(t.tenantId, t.mealId, t.ordem),
    index('meal_items_alimento_idx').on(t.foodId),
  ],
);
```

Em `src/db/schema/index.ts`: `export * from './plano-alimentar';`.

Run: `pnpm db:generate --name planos_alimentares` → `drizzle/0044_planos_alimentares.sql` (confira os dois índices únicos parciais e as 6 FKs).

Run: `pnpm drizzle-kit generate --custom --name rls_planos_alimentares` e preencher `drizzle/0045_rls_planos_alimentares.sql`:

```sql
SELECT app_enable_tenant_rls('meal_plans');
--> statement-breakpoint
SELECT app_enable_patient_rls('meal_plans');
--> statement-breakpoint
SELECT app_enable_audit('meal_plans', 'plano_alimentar');
--> statement-breakpoint
SELECT app_enable_tenant_rls('meals');
--> statement-breakpoint
SELECT app_enable_patient_rls('meals');
--> statement-breakpoint
SELECT app_enable_audit('meals', 'plano_alimentar');
--> statement-breakpoint
SELECT app_enable_tenant_rls('meal_items');
--> statement-breakpoint
SELECT app_enable_patient_rls('meal_items');
--> statement-breakpoint
SELECT app_enable_audit('meal_items', 'plano_alimentar');
--> statement-breakpoint
-- D12 (US-025 "Rascunho invisível", nem pela API): sessão de paciente nunca vê nem grava rascunho
CREATE POLICY paciente_sem_rascunho ON meal_plans AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR status <> 'rascunho')
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR status <> 'rascunho');
--> statement-breakpoint
CREATE POLICY paciente_sem_rascunho ON meals AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meals.tenant_id AND p.id = meals.plan_id AND p.status <> 'rascunho'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meals.tenant_id AND p.id = meals.plan_id AND p.status <> 'rascunho'));
--> statement-breakpoint
CREATE POLICY paciente_sem_rascunho ON meal_items AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meal_items.tenant_id AND p.id = meal_items.plan_id AND p.status <> 'rascunho'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meal_items.tenant_id AND p.id = meal_items.plan_id AND p.status <> 'rascunho'));
```

`test/isolamento.test.ts`, no `FABRICAS` (os planos-mãe de `meals`/`meal_items` são `arquivado`, então não esbarram no "1 publicado por paciente" nem na política D12):

```ts
  meal_plans: (t, p) => sql`insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'publicado')`,
  meals: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id)
        insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem) select gen_random_uuid(), ${t}, ${p}, pl.id, 'Café', 0 from pl`,
  meal_items: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id),
             ml as (insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem) select gen_random_uuid(), ${t}, ${p}, pl.id, 'Café', 0 from pl returning id, plan_id)
        insert into meal_items (id, tenant_id, patient_id, plan_id, meal_id, food_id, quantidade_g, ordem)
        select gen_random_uuid(), ${t}, ${p}, ml.plan_id, ml.id, '00000000-0000-4000-8000-000000000003', 100, 0 from ml`,
```

`const ULTIMAS = ['meals', 'meal_plans', 'anamnesis_templates', 'foods', 'patients'];` — `meal_items` é apagada antes de `meals` e de `meal_plans` (senão o cascade apaga as linhas antes de o teste contá-las) e antes de `foods` (FK `RESTRICT`).

Em `src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `plano_alimentar: 'Plano alimentar',`.

Run: `pnpm test src/db test/isolamento.test.ts`
Expected: PASS (guardas de RLS e de auditoria aceitam as 3 tabelas; a matriz cobre tenant e paciente).

- [ ] **Step 2: Tipos, erros e leitura**

`src/modules/plano-alimentar/tipos.ts`:

```ts
import type { MedidaCaseira, MedidaDoItem } from '@/db/schema';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import type { MedidaDisponivel } from '@/modules/alimentos/medidas';

/** Só tipos: o editor (cliente) importa daqui sem puxar banco. */
export type StatusPlano = 'rascunho' | 'publicado' | 'arquivado';
export type { MedidaCaseira, MedidaDoItem };

export type ItemPlano = {
  id: string;
  foodId: string;
  nome: string;
  origem: 'TACO' | 'Meu alimento';
  porCem: Nutrientes100;
  /** Medidas disponíveis para trocar (só no rascunho; publicado = []). */
  medidas: MedidaDisponivel[];
  quantidadeG: number;
  medida: MedidaDoItem | null;
  medidaCaseiraTxt: string | null;
  substituiItemId: string | null;
};

export type RefeicaoPlano = { id: string; nome: string; horario: string; observacao: string; itens: ItemPlano[] };

export type PlanoCompleto = {
  id: string;
  patientId: string | null;
  isTemplate: boolean;
  titulo: string;
  metaKcal: number | null;
  energyCalcId: string | null;
  status: StatusPlano;
  versao: number;
  revisao: number;
  publicadoEm: string | null;
  mostrarCalorias: boolean;
  orientacoes: string;
  pdfStatus: 'pendente' | 'pronto' | 'falhou' | null;
  pdfPath: string | null;
  refeicoes: RefeicaoPlano[];
};

/** Corpo do PUT do salvamento automático (D7). Quantidade e meta vão como texto digitado. */
export type RascunhoEnviado = {
  revisao: number;
  titulo: string;
  metaKcal: string;
  /** "Usar como meta do plano" (US-014 → P04-05): cálculo de gasto energético de onde veio a meta; null se digitada. */
  energyCalcId?: string | null;
  mostrarCalorias: boolean;
  orientacoes: string;
  refeicoes: {
    id: string;
    nome: string;
    horario: string;
    observacao: string;
    itens: { id: string; foodId: string; quantidadeG: string; medida: MedidaDoItem | null; substituiItemId: string | null }[];
  }[];
};
```

`src/modules/plano-alimentar/erros.ts`:

```ts
import { MSG_PLANO } from './constantes';

export class PlanoNaoEncontradoError extends Error {
  override name = 'PlanoNaoEncontradoError';
  constructor() {
    super(MSG_PLANO.naoEncontrado);
  }
}
export class PlanoNaoEditavelError extends Error {
  override name = 'PlanoNaoEditavelError';
  constructor() {
    super(MSG_PLANO.naoEditavel);
  }
}
export class ConflitoRevisaoError extends Error {
  override name = 'ConflitoRevisaoError';
  constructor() {
    super(MSG_PLANO.conflito);
  }
}
export class PlanoError extends Error {
  override name = 'PlanoError';
  constructor(readonly erros: Record<string, string>) {
    super('Plano inválido');
  }
}
```

`src/modules/plano-alimentar/carregar.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { foods, mealItems, mealPlans, meals } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { medidasDeVarios } from '@/modules/alimentos/medidas';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import type { PlanoCompleto, StatusPlano } from './tipos';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/**
 * Plano inteiro na transação. Rascunho/modelo: valores atuais dos alimentos + medidas para trocar.
 * Publicado/arquivado: a cópia congelada na publicação (D10), sem medidas para trocar.
 */
export async function lerPlanoNaTransacao(tx: Tx, planId: string, opts: { auditar?: boolean } = {}): Promise<PlanoCompleto | null> {
  if (!idValido(planId)) return null;
  const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId));
  if (!p) return null;
  const rs = await tx.select().from(meals).where(eq(meals.planId, p.id)).orderBy(asc(meals.ordem));
  const its = await tx
    .select({ i: mealItems, f: { nome: foods.nome, tenantId: foods.tenantId, kcal: foods.kcal, proteinaG: foods.proteinaG, carboidratoG: foods.carboidratoG, lipidioG: foods.lipidioG, fibraG: foods.fibraG } })
    .from(mealItems)
    .innerJoin(foods, eq(foods.id, mealItems.foodId))
    .where(and(eq(mealItems.planId, p.id)))
    .orderBy(asc(mealItems.ordem));
  const editavel = p.status === 'rascunho';
  const medidas = editavel ? await medidasDeVarios(tx, its.map((x) => x.i.foodId)) : new Map();
  if (opts.auditar !== false && p.patientId) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: p.patientId });
  return {
    id: p.id,
    patientId: p.patientId,
    isTemplate: p.isTemplate,
    titulo: p.titulo,
    metaKcal: p.metaKcal,
    energyCalcId: p.energyCalcId,
    status: p.status as StatusPlano,
    versao: p.versao,
    revisao: p.revisao,
    publicadoEm: p.publicadoEm?.toISOString() ?? null,
    mostrarCalorias: p.mostrarCalorias,
    orientacoes: p.orientacoes,
    pdfStatus: p.pdfStatus as PlanoCompleto['pdfStatus'],
    pdfPath: p.pdfPath,
    refeicoes: rs.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: hhmm(r.horario),
      observacao: r.observacao,
      itens: its
        .filter((x) => x.i.mealId === r.id)
        .map(({ i, f }) => {
          const congelado = !editavel && i.nutrientes;
          const v = congelado ? i.nutrientes! : { ...f, origem: f.tenantId === null ? ('TACO' as const) : ('Meu alimento' as const) };
          return {
            id: i.id,
            foodId: i.foodId,
            nome: v.nome,
            origem: v.origem,
            porCem: { kcal: v.kcal, proteinaG: v.proteinaG, carboidratoG: v.carboidratoG, lipidioG: v.lipidioG, fibraG: v.fibraG },
            medidas: medidas.get(i.foodId) ?? [],
            quantidadeG: i.quantidadeG,
            medida: i.medida ?? null,
            medidaCaseiraTxt: i.medidaCaseiraTxt,
            substituiItemId: i.substituiItemId,
          };
        }),
    })),
  };
}

/** Leitura auditada (RNF-08) de um plano do tenant; modelo não tem paciente e não gera leitura auditada. */
export async function carregarPlano(ctx: TenantContext, planId: string, db: Db = getDb()): Promise<PlanoCompleto | null> {
  if (!idValido(planId)) return null;
  return withTenant(ctx, (tx) => lerPlanoNaTransacao(tx, planId), db);
}
```

- [ ] **Step 3: Testes do rascunho (falham)** — `src/modules/plano-alimentar/rascunho.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEncontradoError } from './erros';
import { criarRascunho, descartarRascunho, salvarRascunho } from './rascunho';
import type { RascunhoEnviado } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PlanoError) return e.erros;
    throw e;
  }
  throw new Error('esperava PlanoError');
};

const COLHER = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 };

/** Rascunho com Café (pão francês 50 g + tapioca como substituição) e Almoço (arroz: 4 colheres de sopa cheias). */
function conteudo(revisao: number, ids = { cafe: randomUUID(), almoco: randomUUID(), pao: randomUUID(), sub: randomUUID(), arroz: randomUUID() }): RascunhoEnviado {
  return {
    revisao,
    titulo: 'Plano de Ana',
    metaKcal: '2000',
    mostrarCalorias: false,
    orientacoes: 'Beber 2 litros de água por dia.',
    refeicoes: [
      { id: ids.cafe, nome: 'Café da manhã', horario: '07:30', observacao: '', itens: [
        { id: ids.pao, foodId: idTaco(53), quantidadeG: '50', medida: null, substituiItemId: null },
        { id: ids.sub, foodId: idTaco(533), quantidadeG: '100', medida: null, substituiItemId: ids.pao },
      ] },
      { id: ids.almoco, nome: 'Almoço', horario: '12:00', observacao: 'Prato colorido', itens: [
        { id: ids.arroz, foodId: idTaco(3), quantidadeG: '100', medida: COLHER, substituiItemId: null },
      ] },
    ],
  };
}

async function comRascunho(T: TenantDeTeste) {
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  return { p, id };
}

const auditDoPlano = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.entidade, 'plano_alimentar'))), app.db);

describe('rascunho do plano (US-022, D7, D11)', () => {
  it('criar: versão 1, título padrão; chamar de novo devolve o mesmo rascunho', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const a = await criarRascunho(T.ctx, p.id, deps);
    expect(a.criado).toBe(true);
    expect(await criarRascunho(T.ctx, p.id, deps)).toEqual({ id: a.id, criado: false });
    expect(await carregarPlano(T.ctx, a.id, app.db)).toMatchObject({ status: 'rascunho', versao: 1, revisao: 0, titulo: 'Plano alimentar', refeicoes: [] });
  });

  it('salvar grava refeições, itens, medida ("4 colheres de sopa cheias" = 100 g) e substituição; revisão sobe', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    expect(await salvarRascunho(T.ctx, id, conteudo(0), deps)).toEqual({ revisao: 1 });
    const pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl).toMatchObject({ titulo: 'Plano de Ana', metaKcal: 2000, orientacoes: 'Beber 2 litros de água por dia.', revisao: 1 });
    expect(pl!.refeicoes.map((r) => [r.nome, r.horario, r.itens.length])).toEqual([['Café da manhã', '07:30', 2], ['Almoço', '12:00', 1]]);
    expect(pl!.refeicoes[1].itens[0]).toMatchObject({ nome: 'Arroz, tipo 1, cozido', origem: 'TACO', quantidadeG: 100, medidaCaseiraTxt: '4 colheres de sopa cheias', porCem: { kcal: 128 } });
    expect(pl!.refeicoes[0].itens[1].substituiItemId).toBe(pl!.refeicoes[0].itens[0].id);
  });

  it('salvar o mesmo conteúdo de novo não gera auditoria nova (só o que mudou vira audit_log)', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    const c = conteudo(0);
    await salvarRascunho(T.ctx, id, c, deps);
    const antes = (await auditDoPlano(T, p.id)).filter((a) => a.acao !== 'ler').length;
    await salvarRascunho(T.ctx, id, { ...c, revisao: 1 }, deps);
    const depois = await auditDoPlano(T, p.id);
    expect(depois.filter((a) => a.acao !== 'ler').length).toBe(antes + 1); // só o UPDATE do meal_plans (revisão)
    const c2 = { ...c, revisao: 2, refeicoes: [c.refeicoes[0], { ...c.refeicoes[1], itens: [{ ...c.refeicoes[1].itens[0], quantidadeG: '150', medida: null }] }] };
    await salvarRascunho(T.ctx, id, c2, deps);
    const novos = (await auditDoPlano(T, p.id)).filter((a) => a.acao === 'alterar').length - depois.filter((a) => a.acao === 'alterar').length;
    expect(novos).toBe(2); // o item do arroz e o meal_plans
  });

  it('Review Focus 1: revisão velha (outra aba) recebe conflito e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    await salvarRascunho(T.ctx, id, conteudo(0), deps);
    await expect(salvarRascunho(T.ctx, id, { ...conteudo(0), titulo: 'Outra aba' }, deps)).rejects.toBeInstanceOf(ConflitoRevisaoError);
    expect((await carregarPlano(T.ctx, id, app.db))?.titulo).toBe('Plano de Ana');
  });

  it('Review Focus 2: quantidade, meta, horário, nome e limites viram erro do campo, nunca gravação parcial', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const c = conteudo(0);
    const arroz = c.refeicoes[1].itens[0];
    for (const q of ['abc', '0', '-10', '99999', '']) {
      const ruim = { ...c, refeicoes: [c.refeicoes[0], { ...c.refeicoes[1], itens: [{ ...arroz, medida: null, quantidadeG: q }] }] };
      expect(await erros(salvarRascunho(T.ctx, id, ruim, deps)), q).toEqual({ [`item:${arroz.id}:quantidadeG`]: MSG_PLANO.quantidade });
    }
    expect(await erros(salvarRascunho(T.ctx, id, { ...c, metaKcal: '100', titulo: ' ', refeicoes: [{ ...c.refeicoes[0], horario: '25:00', nome: '' }] }, deps))).toEqual({
      metaKcal: MSG_PLANO.meta,
      titulo: MSG_PLANO.titulo,
      [`refeicao:${c.refeicoes[0].id}:horario`]: MSG_PLANO.horario,
      [`refeicao:${c.refeicoes[0].id}:nome`]: MSG_PLANO.refeicaoNome,
    });
    const muitas = Array.from({ length: 16 }, () => ({ id: randomUUID(), nome: 'R', horario: '', observacao: '', itens: [] }));
    expect(await erros(salvarRascunho(T.ctx, id, { ...c, refeicoes: muitas }, deps))).toEqual({ geral: MSG_PLANO.limite });
    expect(await erros(salvarRascunho(T.ctx, id, { foo: 1 }, deps))).toHaveProperty('geral');
    expect((await carregarPlano(T.ctx, id, app.db))?.refeicoes).toEqual([]);
  });

  it('substituição só aponta para principal da mesma refeição; apagar o principal leva as substituições', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const c = conteudo(0);
    const [cafe, almoco] = c.refeicoes;
    const outraRefeicao = { ...c, refeicoes: [cafe, { ...almoco, itens: [...almoco.itens, { ...cafe.itens[1], id: randomUUID(), substituiItemId: cafe.itens[0].id }] }] };
    const idErrado = outraRefeicao.refeicoes[1].itens[1].id;
    expect(await erros(salvarRascunho(T.ctx, id, outraRefeicao, deps))).toEqual({ [`item:${idErrado}:substituiItemId`]: MSG_PLANO.substituicao });
    const deSubstituicao = { ...c, refeicoes: [{ ...cafe, itens: [...cafe.itens, { ...cafe.itens[1], id: randomUUID(), substituiItemId: cafe.itens[1].id }] }, almoco] };
    expect(Object.values(await erros(salvarRascunho(T.ctx, id, deSubstituicao, deps)))).toEqual([MSG_PLANO.substituicao]);
    await salvarRascunho(T.ctx, id, c, deps);
    await salvarRascunho(T.ctx, id, { ...c, revisao: 1, refeicoes: [{ ...cafe, itens: [] }, almoco] }, deps);
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[0].itens).toEqual([]);
  });

  it('mover item (com a sua substituição) para outra refeição', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const c = conteudo(0);
    await salvarRascunho(T.ctx, id, c, deps);
    const [cafe, almoco] = c.refeicoes;
    await salvarRascunho(T.ctx, id, { ...c, revisao: 1, refeicoes: [{ ...cafe, itens: [] }, { ...almoco, itens: [...almoco.itens, ...cafe.itens] }] }, deps);
    const pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl!.refeicoes[1].itens.map((i) => i.id)).toEqual([almoco.itens[0].id, cafe.itens[0].id, cafe.itens[1].id]);
    expect(pl!.refeicoes[1].itens[2].substituiItemId).toBe(cafe.itens[0].id);
  });

  it('alimento invisível (de outro tenant) é recusado; id de refeição de outro plano é conflito', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const [deB] = await withTenant(
      B.ctx,
      (tx) => tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${B.tenantId}, 'Só de B', 'Miscelâneas', 1, 1, 1, 1, 1) returning id`),
      app.db,
    ).then((r) => r.rows as { id: string }[]);
    const { id } = await comRascunho(A);
    const c = conteudo(0);
    const item = c.refeicoes[1].itens[0];
    expect(await erros(salvarRascunho(A.ctx, id, { ...c, refeicoes: [c.refeicoes[0], { ...c.refeicoes[1], itens: [{ ...item, foodId: deB.id }] }] }, deps))).toEqual({
      [`item:${item.id}:foodId`]: MSG_PLANO.alimento,
    });
    const outro = await comRascunho(A);
    await salvarRascunho(A.ctx, outro.id, c, deps);
    await expect(salvarRascunho(A.ctx, id, c, deps)).rejects.toBeInstanceOf(ConflitoRevisaoError); // mesmos ids de refeição/itens
  });

  it('outro tenant não acha o plano; paciente bloqueado não edita; descartar apaga o rascunho', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { p, id } = await comRascunho(A);
    await expect(salvarRascunho(B.ctx, id, conteudo(0), deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    expect(await carregarPlano(B.ctx, id, app.db)).toBeNull();
    await expect(criarRascunho(B.ctx, p.id, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(salvarRascunho(A.ctx, id, conteudo(0), deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'ativo' }).where(eq(patients.id, p.id)), app.db);
    await descartarRascunho(A.ctx, id, deps);
    expect(await carregarPlano(A.ctx, id, app.db)).toBeNull();
  });

  it('carregar plano de paciente registra leitura auditada (RNF-08)', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    await carregarPlano(T.ctx, id, app.db);
    expect((await auditDoPlano(T, p.id)).some((a) => a.acao === 'ler' && a.entidadeId === id)).toBe(true);
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/rascunho.test.ts`
Expected: FAIL — `Cannot find module './rascunho'`.

- [ ] **Step 4: Implementar** — `src/modules/plano-alimentar/rascunho.ts`

```ts
import { and, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { energyCalcs, foods, mealItems, mealPlans, meals, type MedidaDoItem } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { gramasDaMedida, QTD_MEDIDA_MAX, textoMedida } from '@/modules/alimentos/medidas-constantes';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { lerDecimal, arredondar } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { lerQuantidade } from './calculo';
import { MAX_ITENS, MAX_REFEICOES, MAX_TEXTO, META_MAX, META_MIN, MSG_PLANO } from './constantes';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';

type Deps = { db?: Db; now?: Date };

/** Próxima versão do paciente (publicadas, arquivadas e rascunho contam). */
export async function proximaVersao(tx: Tx, patientId: string): Promise<number> {
  const [r] = await tx.select({ v: max(mealPlans.versao) }).from(mealPlans).where(eq(mealPlans.patientId, patientId));
  return (r?.v ?? 0) + 1;
}

/** D11: um rascunho por paciente — se já existe, devolve o existente. */
export async function criarRascunho(ctx: TenantContext, patientId: string, deps: Deps = {}): Promise<{ id: string; criado: boolean }> {
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const [existe] = await tx
        .select({ id: mealPlans.id })
        .from(mealPlans)
        .where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'rascunho')));
      if (existe) return { id: existe.id, criado: false };
      const [p] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, patientId, titulo: 'Plano alimentar', versao: await proximaVersao(tx, patientId) })
        .returning({ id: mealPlans.id });
      return { id: p.id, criado: true };
    },
    deps.db ?? getDb(),
  );
}

type ItemValido = { id: string; mealId: string; foodId: string; quantidadeG: number; medida: MedidaDoItem | null; medidaCaseiraTxt: string | null; substituiItemId: string | null; ordem: number };
type RefeicaoValida = { id: string; nome: string; horario: string | null; observacao: string; ordem: number };
type Validado = { revisao: number; titulo: string; metaKcal: number | null; energyCalcId: string | null; mostrarCalorias: boolean; orientacoes: string; refeicoes: RefeicaoValida[]; itens: ItemValido[] };

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const medidaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  gramas: z.number().min(0.1).max(5000),
  qtd: z.number().gt(0).max(QTD_MEDIDA_MAX),
});

/** Validação completa antes de tocar no banco: erro por campo (chaves `item:<id>:…`), nunca gravação parcial. */
function validar(entrada: unknown): Validado {
  const o = (entrada ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || !Array.isArray(o.refeicoes) || !Number.isInteger(o.revisao)) throw new PlanoError({ geral: MSG_PLANO.invalido });
  const erros: Record<string, string> = {};
  const titulo = normalizarTexto(o.titulo);
  if (!titulo || titulo.length > 120) erros.titulo = MSG_PLANO.titulo;
  const metaN = lerDecimal(o.metaKcal);
  if (metaN !== null && (Number.isNaN(metaN) || metaN < META_MIN || metaN > META_MAX)) erros.metaKcal = MSG_PLANO.meta;
  const orientacoes = typeof o.orientacoes === 'string' ? o.orientacoes.trim() : '';
  if (orientacoes.length > MAX_TEXTO) erros.orientacoes = MSG_PLANO.texto;
  const refeicoesEntrada = o.refeicoes as Record<string, unknown>[];
  const totalItens = refeicoesEntrada.reduce((n, r) => n + (Array.isArray(r?.itens) ? r.itens.length : 0), 0);
  if (refeicoesEntrada.length > MAX_REFEICOES || totalItens > MAX_ITENS) throw new PlanoError({ geral: MSG_PLANO.limite });

  const ids = new Set<string>();
  const novoId = (id: unknown): id is string => idValido(id) && !ids.has(id) && Boolean(ids.add(id));
  const refeicoes: RefeicaoValida[] = [];
  const itens: ItemValido[] = [];
  refeicoesEntrada.forEach((r, ordem) => {
    if (!novoId(r?.id)) throw new PlanoError({ geral: MSG_PLANO.invalido });
    const chave = `refeicao:${r.id}`;
    const nome = normalizarTexto(r.nome);
    if (!nome || nome.length > 60) erros[`${chave}:nome`] = MSG_PLANO.refeicaoNome;
    const horario = typeof r.horario === 'string' ? r.horario.trim() : '';
    if (horario && !HORARIO.test(horario)) erros[`${chave}:horario`] = MSG_PLANO.horario;
    const observacao = typeof r.observacao === 'string' ? r.observacao.trim() : '';
    if (observacao.length > MAX_TEXTO) erros[`${chave}:observacao`] = MSG_PLANO.texto;
    refeicoes.push({ id: r.id as string, nome, horario: horario || null, observacao, ordem });
    const lista = (Array.isArray(r.itens) ? r.itens : []) as Record<string, unknown>[];
    const principais = new Set(lista.filter((i) => i?.substituiItemId === null || i?.substituiItemId === undefined).map((i) => i?.id));
    lista.forEach((i, ordemItem) => {
      if (!novoId(i?.id)) throw new PlanoError({ geral: MSG_PLANO.invalido });
      const ci = `item:${i.id}`;
      if (!idValido(i.foodId)) erros[`${ci}:foodId`] = MSG_PLANO.alimento;
      let medida: MedidaDoItem | null = null;
      let gramas: number | null;
      if (i.medida !== null && i.medida !== undefined) {
        const m = medidaSchema.safeParse(i.medida);
        if (!m.success) {
          erros[`${ci}:medida`] = MSG_PLANO.quantidade;
          gramas = null;
        } else {
          medida = m.data;
          gramas = lerQuantidade(gramasDaMedida(m.data.qtd, m.data.gramas));
        }
      } else gramas = lerQuantidade(i.quantidadeG);
      if (gramas === null && !erros[`${ci}:medida`]) erros[`${ci}:quantidadeG`] = MSG_PLANO.quantidade;
      const sub = i.substituiItemId ?? null;
      if (sub !== null && (sub === i.id || !principais.has(sub))) erros[`${ci}:substituiItemId`] = MSG_PLANO.substituicao;
      itens.push({
        id: i.id as string,
        mealId: r.id as string,
        foodId: i.foodId as string,
        quantidadeG: gramas ?? 0,
        medida,
        medidaCaseiraTxt: medida ? textoMedida(medida.qtd, medida) : null,
        substituiItemId: sub as string | null,
        ordem: ordemItem,
      });
    });
  });
  if (Object.keys(erros).length) throw new PlanoError(erros);
  return {
    revisao: o.revisao as number,
    titulo,
    metaKcal: metaN === null ? null : arredondar(metaN, 0),
    energyCalcId: idValido(o.energyCalcId) ? o.energyCalcId : null,
    mostrarCalorias: o.mostrarCalorias === true,
    orientacoes,
    refeicoes,
    itens,
  };
}

/** Comparação estável: o jsonb devolve as chaves em outra ordem que o objeto validado. */
const canonico = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico((v as Record<string, unknown>)[k])])) : v;
const iguais = (a: unknown, b: unknown) => JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));

/**
 * D7: aplica só a diferença entre o que o editor mandou e o banco (o gatilho de auditoria registra só o que mudou).
 * Ordem de travas igual à da publicação: paciente → plano.
 */
export async function salvarRascunho(ctx: TenantContext, planId: string, entrada: unknown, deps: Deps = {}): Promise<{ revisao: number }> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  const v = validar(entrada);
  const now = deps.now ?? new Date();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const [antes] = await tx.select({ patientId: mealPlans.patientId }).from(mealPlans).where(eq(mealPlans.id, planId));
        if (!antes) throw new PlanoNaoEncontradoError();
        if (antes.patientId) await carregarPacienteParaEscrita(tx, antes.patientId);
        const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId)).for('update');
        if (p.status !== 'rascunho') throw new PlanoNaoEditavelError();
        if (p.revisao !== v.revisao) throw new ConflitoRevisaoError();

        const foodIds = [...new Set(v.itens.map((i) => i.foodId))];
        const visiveis = new Set(foodIds.length ? (await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, foodIds))).map((f) => f.id) : []);
        const invisiveis = Object.fromEntries(v.itens.filter((i) => !visiveis.has(i.foodId)).map((i) => [`item:${i.id}:foodId`, MSG_PLANO.alimento]));
        if (Object.keys(invisiveis).length) throw new PlanoError(invisiveis);

        const refeicoesAtuais = new Map((await tx.select().from(meals).where(eq(meals.planId, planId))).map((r) => [r.id, r]));
        const itensAtuais = new Map((await tx.select().from(mealItems).where(eq(mealItems.planId, planId))).map((i) => [i.id, i]));
        const novasRefeicoes = new Set(v.refeicoes.map((r) => r.id));
        const novosItens = new Map(v.itens.map((i) => [i.id, i]));

        // 1. Remoções: itens que saíram ou mudaram de refeição (voltam no passo 3) e refeições que saíram
        const sair = [...itensAtuais.values()].filter((i) => !novosItens.has(i.id) || novosItens.get(i.id)!.mealId !== i.mealId).map((i) => i.id);
        if (sair.length) await tx.delete(mealItems).where(and(eq(mealItems.planId, planId), inArray(mealItems.id, sair)));
        for (const id of sair) itensAtuais.delete(id);
        const refeicoesSair = [...refeicoesAtuais.keys()].filter((id) => !novasRefeicoes.has(id));
        if (refeicoesSair.length) await tx.delete(meals).where(and(eq(meals.planId, planId), inArray(meals.id, refeicoesSair)));

        // 2. Refeições novas e alteradas
        for (const r of v.refeicoes) {
          const atual = refeicoesAtuais.get(r.id);
          const dados = { nome: r.nome, horario: r.horario, observacao: r.observacao, ordem: r.ordem };
          if (!atual) await tx.insert(meals).values({ id: r.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, ...dados });
          else if (!iguais({ nome: atual.nome, horario: atual.horario?.slice(0, 5) ?? null, observacao: atual.observacao, ordem: atual.ordem }, dados))
            await tx.update(meals).set({ ...dados, updatedAt: now }).where(eq(meals.id, r.id));
        }

        // 3. Itens: principais antes das substituições (FK meal_items_principal_fk)
        const ordenados = [...v.itens.filter((i) => i.substituiItemId === null), ...v.itens.filter((i) => i.substituiItemId !== null)];
        for (const i of ordenados) {
          const atual = itensAtuais.get(i.id);
          const dados = { foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida, medidaCaseiraTxt: i.medidaCaseiraTxt, substituiItemId: i.substituiItemId, ordem: i.ordem };
          if (!atual) await tx.insert(mealItems).values({ id: i.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, mealId: i.mealId, ...dados });
          else if (!iguais({ foodId: atual.foodId, quantidadeG: atual.quantidadeG, medida: atual.medida ?? null, medidaCaseiraTxt: atual.medidaCaseiraTxt, substituiItemId: atual.substituiItemId, ordem: atual.ordem }, dados))
            await tx.update(mealItems).set({ ...dados, updatedAt: now }).where(eq(mealItems.id, i.id));
        }

        if (v.energyCalcId) {
          // o cálculo precisa ser do mesmo paciente (modelo não tem paciente nem cálculo)
          const [c] = p.patientId
            ? await tx.select({ id: energyCalcs.id }).from(energyCalcs).where(and(eq(energyCalcs.id, v.energyCalcId), eq(energyCalcs.patientId, p.patientId)))
            : [];
          if (!c) throw new PlanoError({ metaKcal: MSG_PLANO.calculo });
        }
        const [r] = await tx
          .update(mealPlans)
          .set({
            titulo: v.titulo,
            metaKcal: v.metaKcal,
            energyCalcId: v.energyCalcId,
            mostrarCalorias: v.mostrarCalorias,
            orientacoes: v.orientacoes,
            revisao: p.revisao + 1,
            updatedAt: now,
          })
          .where(eq(mealPlans.id, planId))
          .returning({ revisao: mealPlans.revisao });
        return { revisao: r.revisao };
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    // id de refeição/item que já é de outro plano: só acontece com duas abas ou corpo adulterado
    if (uniqueViolation(e) === 'meals_pkey' || uniqueViolation(e) === 'meal_items_pkey') throw new ConflitoRevisaoError();
    throw e;
  }
}

/** Copia refeições e itens (ids novos) de um plano para outro: modelos (Tarefa 9) e "Editar" (Tarefa 10). */
export async function copiarConteudo(tx: Tx, origemId: string, destino: { id: string; patientId: string | null; tenantId: string }): Promise<void> {
  const rs = await tx.select().from(meals).where(eq(meals.planId, origemId));
  const its = await tx.select().from(mealItems).where(eq(mealItems.planId, origemId));
  const novoIdRefeicao = new Map(rs.map((r) => [r.id, crypto.randomUUID()]));
  const novoIdItem = new Map(its.map((i) => [i.id, crypto.randomUUID()]));
  if (rs.length)
    await tx.insert(meals).values(
      rs.map((r) => ({ id: novoIdRefeicao.get(r.id)!, tenantId: destino.tenantId, patientId: destino.patientId, planId: destino.id, nome: r.nome, horario: r.horario, ordem: r.ordem, observacao: r.observacao })),
    );
  const linha = (i: (typeof its)[number]) => ({
    id: novoIdItem.get(i.id)!,
    tenantId: destino.tenantId,
    patientId: destino.patientId,
    planId: destino.id,
    mealId: novoIdRefeicao.get(i.mealId)!,
    foodId: i.foodId,
    quantidadeG: i.quantidadeG,
    medida: i.medida,
    medidaCaseiraTxt: i.medidaCaseiraTxt,
    substituiItemId: i.substituiItemId ? novoIdItem.get(i.substituiItemId)! : null,
    ordem: i.ordem,
    nutrientes: null, // D10: a cópia volta a usar os valores atuais dos alimentos
  });
  const principais = its.filter((i) => !i.substituiItemId).map(linha);
  const subs = its.filter((i) => i.substituiItemId).map(linha);
  if (principais.length) await tx.insert(mealItems).values(principais);
  if (subs.length) await tx.insert(mealItems).values(subs);
}

export async function descartarRascunho(ctx: TenantContext, planId: string, deps: Deps = {}): Promise<void> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.status, 'rascunho'), eq(mealPlans.isTemplate, false)));
      if (!p) throw new PlanoNaoEncontradoError();
      await carregarPacienteParaEscrita(tx, p.patientId!);
      await tx.delete(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.status, 'rascunho')));
    },
    deps.db ?? getDb(),
  );
}

```

Run: `pnpm test src/modules/plano-alimentar/rascunho.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 5: API do salvamento automático** — `src/app/api/painel/planos/[id]/route.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { idTaco } from '@/modules/alimentos/taco';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { criarRascunho } from '@/modules/plano-alimentar/rascunho';
import { novoPaciente } from '../../../../../../test/pacientes';
import { nutriComDpa } from '../../../../../../test/nutri';
import { GET, PUT } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const url = (id: string) => `http://localhost:3000/api/painel/planos/${id}`;
const put = (id: string, corpo: unknown, cookie?: string) =>
  PUT(new Request(url(id), { method: 'PUT', body: JSON.stringify(corpo), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }), { params: Promise.resolve({ id }) });
const get = (id: string, cookie?: string) => GET(new Request(url(id), { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
const corpo = (revisao: number, quantidadeG = '100') => ({
  revisao, titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG, medida: null, substituiItemId: null }] }],
});

describe('PUT /api/painel/planos/[id] (US-022 "Salvamento automático", D7)', () => {
  it('200 com a revisão nova; 409 com revisão velha; 422 com erro por campo; 404 para outro tenant; 401 sem sessão', async () => {
    const A = await nutriComDpa(db, auth);
    const B = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    const ok = await put(id, corpo(0), A.cookie);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ revisao: 1 });
    const velho = await put(id, corpo(0), A.cookie);
    expect(velho.status).toBe(409);
    expect(await velho.json()).toEqual({ erro: MSG_PLANO.conflito });
    const invalido = await put(id, corpo(1, 'abc'), A.cookie);
    expect(invalido.status).toBe(422);
    expect(Object.values((await invalido.json()).erros)).toEqual([MSG_PLANO.quantidade]);
    expect((await put(id, corpo(1), B.cookie)).status).toBe(404);
    expect((await put('abc', corpo(1), A.cookie)).status).toBe(404);
    expect((await put(id, corpo(1))).status).toBe(401);
    expect((await get(id, A.cookie)).status).toBe(200);
    expect((await get(id, B.cookie)).status).toBe(404);
  });

  it('corpo que não é JSON é 422; corpo acima de 512 KB é 413', async () => {
    const A = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    const r = await PUT(new Request(url(id), { method: 'PUT', body: '{x', headers: { cookie: A.cookie } }), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(422);
    const grande = await PUT(new Request(url(id), { method: 'PUT', body: 'x'.repeat(600_000), headers: { cookie: A.cookie } }), { params: Promise.resolve({ id }) });
    expect(grande.status).toBe(413);
  });
});
```

`src/app/api/painel/planos/[id]/route.ts`:

```ts
import { requireApiNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { carregarPlano } from '@/modules/plano-alimentar/carregar';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { salvarRascunho } from '@/modules/plano-alimentar/rascunho';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };
const LIMITE_CORPO = 512 * 1024;
const json = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: SEM_CACHE });

export async function GET(req: Request, { params }: RouteContext<'/api/painel/planos/[id]'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const plano = await carregarPlano(acesso.ctx, (await params).id);
  return plano ? json(200, plano) : json(404, { erro: new PlanoNaoEncontradoError().message });
}

/** US-022 "Salvamento automático" (D7). */
export async function PUT(req: Request, { params }: RouteContext<'/api/painel/planos/[id]'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO) return json(413, { erro: 'Plano grande demais.' });
  let entrada: unknown;
  try {
    entrada = JSON.parse(texto);
  } catch {
    return json(422, { erros: { geral: MSG_PLANO.invalido } });
  }
  try {
    return json(200, await salvarRascunho(acesso.ctx, id, entrada));
  } catch (e) {
    if (e instanceof PlanoError) return json(422, { erros: e.erros });
    if (e instanceof ConflitoRevisaoError || e instanceof PlanoNaoEditavelError || e instanceof PacienteBloqueadoError) return json(409, { erro: e.message });
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) return json(404, { erro: new PlanoNaoEncontradoError().message });
    throw e;
  }
}
```

Run: `pnpm test src/app/api/painel/planos` → PASS.

- [ ] **Step 6: Exportação LGPD inclui os planos (US-018)** — em `src/modules/pacientes/exportacao-job.ts`:

No tipo `DadosExportacao`, depois de `atendimentos`:

```ts
  /** Planos alimentares (todas as versões e o rascunho); publicado/arquivado com os valores congelados (D10). */
  planos: {
    versao: number;
    status: string;
    titulo: string;
    publicadoEm: string | null;
    metaKcal: number | null;
    orientacoes: string;
    refeicoes: { nome: string; horario: string; observacao: string; itens: { alimento: string; quantidadeG: number; medida: string | null; substituiDe: string | null }[] }[];
  }[];
```

Em `montarDados`, antes de `const dados: DadosExportacao = {` (imports: `mealPlans` de `@/db/schema`, `lerPlanoNaTransacao` de `@/modules/plano-alimentar/carregar`):

```ts
  const ids = await tx.select({ id: mealPlans.id }).from(mealPlans).where(eq(mealPlans.patientId, patientId)).orderBy(asc(mealPlans.versao));
  const planos: DadosExportacao['planos'] = [];
  for (const { id } of ids) {
    const pl = await lerPlanoNaTransacao(tx, id, { auditar: false }); // a exportação já registra "exportar"
    if (!pl) continue;
    planos.push({
      versao: pl.versao,
      status: pl.status,
      titulo: pl.titulo,
      publicadoEm: pl.publicadoEm,
      metaKcal: pl.metaKcal,
      orientacoes: pl.orientacoes,
      refeicoes: pl.refeicoes.map((r) => ({
        nome: r.nome,
        horario: r.horario,
        observacao: r.observacao,
        itens: r.itens.map((i) => ({
          alimento: i.nome,
          quantidadeG: i.quantidadeG,
          medida: i.medidaCaseiraTxt,
          substituiDe: i.substituiItemId ? (r.itens.find((x) => x.id === i.substituiItemId)?.nome ?? null) : null,
        })),
      })),
    });
  }
```

e, no objeto `dados`, depois de `atendimentos: at,`: `planos,`.

Em `src/modules/pacientes/exportacao.test.ts`, no teste que confere o `dados.json`, antes de pedir a exportação:

```ts
    const { id: planId } = await criarRascunho(T.ctx, p.id, { db: app.db });
    await salvarRascunho(T.ctx, planId, {
      revisao: 0, titulo: 'Plano alimentar', metaKcal: '', mostrarCalorias: false, orientacoes: '',
      refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
    }, { db: app.db });
```

e, nas conferências do `dados.json`:

```ts
    expect(dados.planos).toEqual([
      { versao: 1, status: 'rascunho', titulo: 'Plano alimentar', publicadoEm: null, metaKcal: null, orientacoes: '',
        refeicoes: [{ nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ alimento: 'Arroz, tipo 1, cozido', quantidadeG: 100, medida: null, substituiDe: null }] }] },
    ]);
```

(Use os nomes de variáveis do teste — `T`, `p`, `app` — como estão no arquivo; imports: `randomUUID` de `node:crypto`, `idTaco`, `criarRascunho`, `salvarRascunho`.)

Run: `pnpm test src/modules/pacientes/exportacao.test.ts` → PASS.

- [ ] **Step 7: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/db/schema drizzle/0044_planos_alimentares.sql drizzle/0045_rls_planos_alimentares.sql drizzle/meta test/isolamento.test.ts \
  src/modules/plano-alimentar src/modules/plataforma/audit.ts src/modules/pacientes/exportacao-job.ts src/modules/pacientes/exportacao.test.ts src/app/api/painel/planos
git commit -m "feat(plano-alimentar): tabelas com RLS por paciente e sem rascunho para paciente, salvamento por diferença com trava de revisão e API (P04-05b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Editor do plano — refeições, itens, medidas, meta, macros e salvamento automático com aviso de conexão (P04-05c)

**Files:**
- Create: `src/modules/plano-alimentar/meta.ts`, `src/modules/plano-alimentar/meta.test.ts`, `src/app/painel/planos/editor/estado.ts`, `src/app/painel/planos/editor/estado.test.ts`, `src/app/painel/planos/editor/use-salvamento.ts`, `src/app/painel/planos/editor/painel-totais.tsx`, `src/app/painel/planos/editor/editor-plano.tsx`, `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx`, `src/app/painel/pacientes/[id]/plano-alimentar/actions.ts`, `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx`
- Modify: `src/modules/plano-alimentar/carregar.ts` (`listarPlanosDoPaciente`), `src/app/painel/pacientes/[id]/abas.tsx`, `e2e/plano-alimentar.spec.ts`

**Interfaces:**
- Consumes: `BuscaAlimento`, `Selo`, `type AlimentoEncontrado` (Tarefa 3); `gramasDaMedida`, `textoMedida`, `QTD_MEDIDA_MAX` (Tarefa 2); `lerQuantidade`, `nutrientesDoItem`, `totalDosItens`, `totalDoDia`, `indicadorMeta`, `distribuicaoMacros`, `kcalTexto`, `gTexto`, `type ItemCalculo`, `MSG_PLANO` (Tarefa 5); `carregarPlano`, `type PlanoCompleto`, `type RascunhoEnviado`, `criarRascunho`, `descartarRascunho`, `salvarRascunho`, `PlanoError` (Tarefa 6); `medidasRecentes`, `listarCalculos` (`@/modules/pacientes/gasto-energetico`), `kcal` (`@/modules/pacientes/formulas`); `carregarProntuario` (`src/app/painel/pacientes/[id]/prontuario.ts`); `formatarData`.
- Produces:
  - `@/modules/plano-alimentar/meta`: `type ContextoPaciente = { pesoKg: number | null; calculos: { id: string; rotulo: string; kcal: number }[] }`, `contextoDoPaciente(ctx, patientId, fuso, db?): Promise<ContextoPaciente>`.
  - `@/modules/plano-alimentar/carregar`: `listarPlanosDoPaciente(ctx, patientId, db?): Promise<{ id; versao; status; titulo; publicadoEm: string | null; pdfStatus }[]>` (versão mais nova primeiro).
  - `src/app/painel/planos/editor/estado.ts`: `type EstadoEditor`, `type ItemEstado`, `type Acao`, `estadoInicial(p: PlanoCompleto): EstadoEditor`, `reduzir(e, a): EstadoEditor`, `gramasDoItem(i): number | null`, `refeicoesParaCalculo(e)`, `paraEnvio(e, revisao): RascunhoEnviado`.
  - `src/app/painel/planos/editor/use-salvamento.ts`: `useSalvamento(planId, revisaoInicial, montarEnvio, edicoes)` → `{ status, erros, mensagem }`.
  - `src/app/painel/planos/editor/editor-plano.tsx`: `EditorPlano({ plano, contexto, somenteLeitura?, acoes? })` (as Tarefas 8–10 reaproveitam; `acoes` = botões extras no topo).

- [ ] **Step 1: Meta e peso do paciente (testes falham)** — `src/modules/plano-alimentar/meta.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { idTaco } from '@/modules/alimentos/taco';
import { entradaDoFormulario, registrarAntropometria } from '@/modules/pacientes/antropometria';
import { salvarCalculo } from '@/modules/pacientes/gasto-energetico';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError } from './erros';
import { contextoDoPaciente } from './meta';
import { criarRascunho, salvarRascunho } from './rascunho';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db, now: new Date('2026-10-01T15:00:00Z') };
const corpo = (energyCalcId: string | null, metaKcal: string) => ({
  revisao: 0, titulo: 'Plano', metaKcal, energyCalcId, mostrarCalorias: false, orientacoes: '',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
});

describe('meta do plano a partir do gasto energético (US-014 → US-022) e peso para g/kg (D15)', () => {
  it('contexto traz o peso da última antropometria e os cálculos salvos (kcal inteiros)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await contextoDoPaciente(T.ctx, p.id, T.tenant.fuso, app.db)).toEqual({ pesoKg: null, calculos: [] });
    await registrarAntropometria(T.ctx, T.tenant, p.id, entradaDoFormulario({ data: '2026-09-15', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }), deps);
    const c = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    expect(await contextoDoPaciente(T.ctx, p.id, T.tenant.fuso, app.db)).toEqual({ pesoKg: 60, calculos: [{ id: c.id, rotulo: 'Mifflin-St Jeor · 01/10/2026 · 2008 kcal', kcal: 2008 }] });
  });

  it('"Usar como meta do plano" grava a meta e o cálculo de origem; cálculo de outro paciente é recusado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx, { email: `outro-${randomUUID()}@exemplo.com` });
    const c = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    const cOutro = await salvarCalculo(T.ctx, T.tenant, outro.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    await expect(salvarRascunho(T.ctx, id, corpo(cOutro.id, '2008'), deps)).rejects.toEqual(new PlanoError({ metaKcal: MSG_PLANO.calculo }));
    await salvarRascunho(T.ctx, id, corpo(c.id, '2008'), deps);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ metaKcal: 2008, energyCalcId: c.id });
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/meta.test.ts` → FAIL (`Cannot find module './meta'`).

`src/modules/plano-alimentar/meta.ts`:

```ts
import { getDb, type Db } from '@/db/client';
import type { TenantContext } from '@/db/tenant';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { kcal } from '@/modules/pacientes/formulas';
import { listarCalculos, medidasRecentes } from '@/modules/pacientes/gasto-energetico';

export type ContextoPaciente = { pesoKg: number | null; calculos: { id: string; rotulo: string; kcal: number }[] };

const NOME_FORMULA: Record<string, string> = { harris_benedict: 'Harris-Benedict', mifflin: 'Mifflin-St Jeor', fao_oms: 'FAO/OMS' };

/** Peso para g/kg (D15) e cálculos de GET para "Usar como meta do plano". As duas leituras já são auditadas. */
export async function contextoDoPaciente(ctx: TenantContext, patientId: string, fuso: string, db: Db = getDb()): Promise<ContextoPaciente> {
  const [{ pesoKg }, calculos] = await Promise.all([medidasRecentes(ctx, patientId, db), listarCalculos(ctx, patientId, db)]);
  return {
    pesoKg,
    calculos: calculos.map((c) => ({
      id: c.id,
      kcal: kcal(c.get),
      rotulo: `${NOME_FORMULA[c.formula] ?? c.formula} · ${formatarData(hojeNoFuso(fuso, c.createdAt))} · ${kcal(c.get)} kcal`, // data no fuso do tenant (RN-06)
    })),
  };
}
```

Run: `pnpm test src/modules/plano-alimentar/meta.test.ts` → PASS.

Em `src/modules/plano-alimentar/carregar.ts`, acrescentar:

```ts
/** Versões do plano do paciente (mais nova primeiro) — tela "Plano alimentar" do prontuário. */
export async function listarPlanosDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()) {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: mealPlans.id, versao: mealPlans.versao, status: mealPlans.status, titulo: mealPlans.titulo, publicadoEm: mealPlans.publicadoEm, pdfStatus: mealPlans.pdfStatus })
        .from(mealPlans)
        .where(eq(mealPlans.patientId, patientId))
        .orderBy(desc(mealPlans.versao));
      if (r.length) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: null, patientId });
      return r.map((x) => ({ ...x, status: x.status as StatusPlano, publicadoEm: x.publicadoEm?.toISOString() ?? null }));
    },
    db,
  );
}
```

(imports: `desc`.)

- [ ] **Step 2: Estado do editor (testes falham)** — `src/app/painel/planos/editor/estado.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { totalDoDia } from '@/modules/plano-alimentar/calculo';
import type { PlanoCompleto } from '@/modules/plano-alimentar/tipos';
import { estadoInicial, gramasDoItem, paraEnvio, reduzir, refeicoesParaCalculo, type EstadoEditor } from './estado';

const plano: PlanoCompleto = {
  id: 'p', patientId: 'pac', isTemplate: false, titulo: 'Plano alimentar', metaKcal: null, energyCalcId: null, status: 'rascunho', versao: 1, revisao: 0,
  publicadoEm: null, mostrarCalorias: false, orientacoes: '', pdfStatus: null, pdfPath: null, refeicoes: [],
};
const arroz: AlimentoEncontrado = {
  id: 'f-arroz', nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', origem: 'TACO',
  porCem: { kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 },
  medidas: [{ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 }],
};
const proprio: AlimentoEncontrado = { id: 'f-130', nome: 'Alimento 130', grupo: 'Miscelâneas', origem: 'Meu alimento', porCem: { kcal: 130, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 }, medidas: [] };

const aplicar = (e: EstadoEditor, ...as: Parameters<typeof reduzir>[1][]) => as.reduce(reduzir, e);

describe('estado do editor (US-022)', () => {
  it('nova refeição; alimento com medida entra com 1 medida; sem medida entra com 100 g', () => {
    const e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: arroz }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i2', alimento: proprio });
    expect(e.refeicoes[0]).toMatchObject({ id: 'r1', nome: 'Refeição 1', horario: '' });
    expect(gramasDoItem(e.refeicoes[0].itens[0])).toBe(25);
    expect(gramasDoItem(e.refeicoes[0].itens[1])).toBe(100);
  });

  it('"Medidas caseiras": quantidade 4 da colher de sopa cheia = 100 g; trocar para gramas mantém o valor', () => {
    let e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: arroz }, { tipo: 'qtdMedida', itemId: 'i1', valor: '4' });
    expect(gramasDoItem(e.refeicoes[0].itens[0])).toBe(100);
    expect(paraEnvio(e, 3).refeicoes[0].itens[0]).toEqual({ id: 'i1', foodId: 'f-arroz', quantidadeG: '100', medida: { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 }, substituiItemId: null });
    e = reduzir(e, { tipo: 'medida', itemId: 'i1', medida: null });
    expect(e.refeicoes[0].itens[0]).toMatchObject({ medida: null, quantidadeTexto: '100' });
    e = reduzir(e, { tipo: 'quantidade', itemId: 'i1', valor: '1,5' });
    expect(gramasDoItem(e.refeicoes[0].itens[0])).toBe(1.5);
  });

  it('"Cálculo do item": 150 g de 130 kcal/100 g → 195 kcal no total do dia; quantidade inválida não vira NaN', () => {
    let e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: proprio }, { tipo: 'quantidade', itemId: 'i1', valor: '150' });
    expect(totalDoDia(refeicoesParaCalculo(e)).kcal).toBe(195);
    e = reduzir(e, { tipo: 'quantidade', itemId: 'i1', valor: 'abc' });
    expect(totalDoDia(refeicoesParaCalculo(e)).kcal).toBe(0);
  });

  it('remover o principal remove as substituições; mover troca a ordem dentro da refeição', () => {
    let e = aplicar(
      estadoInicial(plano),
      { tipo: 'novaRefeicao', id: 'r1' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'a', alimento: arroz },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'b', alimento: proprio },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 's', alimento: proprio, substituiItemId: 'a' },
      { tipo: 'moverItem', itemId: 'b', direcao: -1 },
    );
    expect(e.refeicoes[0].itens.map((i) => i.id)).toEqual(['b', 'a', 's']);
    e = reduzir(e, { tipo: 'removerItem', itemId: 'a' });
    expect(e.refeicoes[0].itens.map((i) => i.id)).toEqual(['b']);
  });

  it('"Usar como meta do plano" grava meta e cálculo; digitar a meta desliga o cálculo de origem', () => {
    let e = reduzir(estadoInicial(plano), { tipo: 'usarCalculo', id: 'calc', kcal: 2008 });
    expect(paraEnvio(e, 0)).toMatchObject({ metaKcal: '2008', energyCalcId: 'calc' });
    e = reduzir(e, { tipo: 'meta', valor: '1900' });
    expect(paraEnvio(e, 0)).toMatchObject({ metaKcal: '1900', energyCalcId: null });
  });
});
```

Run: `pnpm test src/app/painel/planos/editor/estado.test.ts` → FAIL (`Cannot find module './estado'`).

- [ ] **Step 3: Implementar o estado** — `src/app/painel/planos/editor/estado.ts`

```ts
import { formatarDecimal, casasDecimais, lerDecimal } from '@/lib/numero';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { gramasDaMedida, QTD_MEDIDA_MAX } from '@/modules/alimentos/medidas-constantes';
import { lerQuantidade, type ItemCalculo } from '@/modules/plano-alimentar/calculo';
import type { ItemPlano, PlanoCompleto, RascunhoEnviado } from '@/modules/plano-alimentar/tipos';

/** Estado local do editor: textos como a nutricionista digitou; números só na hora de calcular e enviar. */
export type ItemEstado = Omit<ItemPlano, 'quantidadeG' | 'medida' | 'medidaCaseiraTxt'> & {
  quantidadeTexto: string;
  medida: { nome: string; plural: string; gramas: number } | null;
  qtdTexto: string;
};
export type RefeicaoEstado = { id: string; nome: string; horario: string; observacao: string; itens: ItemEstado[] };
export type EstadoEditor = { titulo: string; metaTexto: string; energyCalcId: string | null; mostrarCalorias: boolean; orientacoes: string; refeicoes: RefeicaoEstado[] };

export type Acao =
  | { tipo: 'titulo'; valor: string }
  | { tipo: 'meta'; valor: string }
  | { tipo: 'usarCalculo'; id: string; kcal: number }
  | { tipo: 'mostrarCalorias'; valor: boolean }
  | { tipo: 'orientacoes'; valor: string }
  | { tipo: 'novaRefeicao'; id: string }
  | { tipo: 'refeicao'; id: string; campo: 'nome' | 'horario' | 'observacao'; valor: string }
  | { tipo: 'removerRefeicao'; id: string }
  | { tipo: 'adicionarItem'; refeicaoId: string; id: string; alimento: AlimentoEncontrado; substituiItemId?: string | null }
  | { tipo: 'quantidade'; itemId: string; valor: string }
  | { tipo: 'medida'; itemId: string; medida: { nome: string; plural: string; gramas: number } | null }
  | { tipo: 'qtdMedida'; itemId: string; valor: string }
  | { tipo: 'removerItem'; itemId: string }
  | { tipo: 'moverItem'; itemId: string; direcao: -1 | 1 };

const numTexto = (n: number) => formatarDecimal(n, casasDecimais(n));

export function estadoInicial(p: PlanoCompleto): EstadoEditor {
  return {
    titulo: p.titulo,
    metaTexto: p.metaKcal === null ? '' : String(p.metaKcal),
    energyCalcId: p.energyCalcId,
    mostrarCalorias: p.mostrarCalorias,
    orientacoes: p.orientacoes,
    refeicoes: p.refeicoes.map((r) => ({
      ...r,
      itens: r.itens.map(({ quantidadeG, medida, medidaCaseiraTxt: _, ...i }) => ({
        ...i,
        quantidadeTexto: numTexto(quantidadeG),
        medida: medida ? { nome: medida.nome, plural: medida.plural, gramas: medida.gramas } : null,
        qtdTexto: medida ? numTexto(medida.qtd) : '',
      })),
    })),
  };
}

/** Gramas do item ou null se o que foi digitado é inválido (o total trata como fora da conta). */
export function gramasDoItem(i: ItemEstado): number | null {
  if (!i.medida) return lerQuantidade(i.quantidadeTexto);
  const q = lerDecimal(i.qtdTexto);
  if (q === null || Number.isNaN(q) || q <= 0 || q > QTD_MEDIDA_MAX) return null;
  return lerQuantidade(gramasDaMedida(q, i.medida.gramas));
}

const nosItens = (e: EstadoEditor, f: (itens: ItemEstado[]) => ItemEstado[]): EstadoEditor => ({ ...e, refeicoes: e.refeicoes.map((r) => ({ ...r, itens: f(r.itens) })) });
const noItem = (e: EstadoEditor, id: string, f: (i: ItemEstado) => ItemEstado) => nosItens(e, (its) => its.map((i) => (i.id === id ? f(i) : i)));

export function reduzir(e: EstadoEditor, a: Acao): EstadoEditor {
  switch (a.tipo) {
    case 'titulo':
      return { ...e, titulo: a.valor };
    case 'meta':
      return { ...e, metaTexto: a.valor, energyCalcId: null };
    case 'usarCalculo':
      return { ...e, metaTexto: String(a.kcal), energyCalcId: a.id };
    case 'mostrarCalorias':
      return { ...e, mostrarCalorias: a.valor };
    case 'orientacoes':
      return { ...e, orientacoes: a.valor };
    case 'novaRefeicao':
      return { ...e, refeicoes: [...e.refeicoes, { id: a.id, nome: `Refeição ${e.refeicoes.length + 1}`, horario: '', observacao: '', itens: [] }] };
    case 'refeicao':
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.id ? { ...r, [a.campo]: a.valor } : r)) };
    case 'removerRefeicao':
      return { ...e, refeicoes: e.refeicoes.filter((r) => r.id !== a.id) };
    case 'adicionarItem': {
      const m = a.alimento.medidas[0];
      const novo: ItemEstado = {
        id: a.id,
        foodId: a.alimento.id,
        nome: a.alimento.nome,
        origem: a.alimento.origem,
        porCem: a.alimento.porCem,
        medidas: a.alimento.medidas,
        substituiItemId: a.substituiItemId ?? null,
        medida: m ? { nome: m.nome, plural: m.plural, gramas: m.gramas } : null,
        qtdTexto: m ? '1' : '',
        quantidadeTexto: m ? numTexto(m.gramas) : '100',
      };
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.refeicaoId ? { ...r, itens: [...r.itens, novo] } : r)) };
    }
    case 'quantidade':
      return noItem(e, a.itemId, (i) => ({ ...i, quantidadeTexto: a.valor }));
    case 'medida':
      return noItem(e, a.itemId, (i) => {
        const g = gramasDoItem(i);
        return a.medida ? { ...i, medida: a.medida, qtdTexto: '1' } : { ...i, medida: null, quantidadeTexto: g === null ? i.quantidadeTexto : numTexto(g) };
      });
    case 'qtdMedida':
      return noItem(e, a.itemId, (i) => ({ ...i, qtdTexto: a.valor }));
    case 'removerItem':
      return nosItens(e, (its) => its.filter((i) => i.id !== a.itemId && i.substituiItemId !== a.itemId));
    case 'moverItem':
      return nosItens(e, (its) => {
        const k = its.findIndex((i) => i.id === a.itemId);
        const j = k + a.direcao;
        if (k < 0 || j < 0 || j >= its.length) return its;
        const novo = [...its];
        [novo[k], novo[j]] = [novo[j], novo[k]];
        return novo;
      });
  }
}

export const refeicoesParaCalculo = (e: EstadoEditor): { itens: ItemCalculo[] }[] =>
  e.refeicoes.map((r) => ({ itens: r.itens.map((i) => ({ id: i.id, quantidadeG: gramasDoItem(i), porCem: i.porCem, substituiItemId: i.substituiItemId })) }));

/** Corpo do PUT (D7). Quantidade inválida vai como texto para o servidor devolver o erro do campo. */
export function paraEnvio(e: EstadoEditor, revisao: number): RascunhoEnviado {
  return {
    revisao,
    titulo: e.titulo,
    metaKcal: e.metaTexto,
    energyCalcId: e.energyCalcId,
    mostrarCalorias: e.mostrarCalorias,
    orientacoes: e.orientacoes,
    refeicoes: e.refeicoes.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
      itens: r.itens.map((i) => {
        const g = gramasDoItem(i);
        const q = lerDecimal(i.qtdTexto);
        return {
          id: i.id,
          foodId: i.foodId,
          quantidadeG: g === null ? i.quantidadeTexto : numTexto(g).replace(',', '.'),
          medida: i.medida ? { ...i.medida, qtd: q !== null && Number.isFinite(q) ? q : 0 } : null,
          substituiItemId: i.substituiItemId,
        };
      }),
    })),
  };
}
```

Run: `pnpm test src/app/painel/planos/editor/estado.test.ts` → PASS (5 testes). (`quantidadeG` sai com ponto: `'100'`, `'1.5'`; o servidor lê os dois.)

- [ ] **Step 4: Salvamento automático** — `src/app/painel/planos/editor/use-salvamento.ts`

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import type { RascunhoEnviado } from '@/modules/plano-alimentar/tipos';

export type StatusSalvamento = 'salvo' | 'salvando' | 'offline' | 'conflito' | 'erro';

const MENSAGEM: Record<StatusSalvamento, string> = {
  salvo: 'Salvo',
  salvando: 'Salvando…',
  offline: 'Alterações não salvas',
  conflito: MSG_PLANO.conflito,
  erro: 'Corrija os campos destacados para salvar.',
};
const ESPERA_MS = 800; // US-022: salvo em até 2 s
const REPETIR_MS = 5000;

/**
 * D7: a cada edição (`edicoes` muda), espera 800 ms e envia o rascunho inteiro com a revisão atual.
 * Sem rede: "Alterações não salvas" e nova tentativa a cada 5 s e quando o navegador volta a ficar online.
 */
export function useSalvamento(planId: string, revisaoInicial: number, montarEnvio: (revisao: number) => RascunhoEnviado, edicoes: number) {
  const [status, setStatus] = useState<StatusSalvamento>('salvo');
  const [erros, setErros] = useState<Record<string, string>>({});
  const revisao = useRef(revisaoInicial);
  const montar = useRef(montarEnvio);
  montar.current = montarEnvio;
  const emVoo = useRef(false);
  const pendente = useRef(false);
  const parado = useRef(false); // conflito: não insiste

  const salvar = useCallback(async () => {
    if (parado.current) return;
    if (emVoo.current) {
      pendente.current = true;
      return;
    }
    emVoo.current = true;
    pendente.current = false;
    setStatus('salvando');
    try {
      const r = await fetch(`/api/painel/planos/${planId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(montar.current(revisao.current)),
      });
      if (r.ok) {
        revisao.current = ((await r.json()) as { revisao: number }).revisao;
        setErros({});
        setStatus(pendente.current ? 'salvando' : 'salvo');
      } else if (r.status === 409) {
        parado.current = true;
        setStatus('conflito');
      } else if (r.status === 422) {
        setErros(((await r.json()) as { erros: Record<string, string> }).erros);
        setStatus('erro');
      } else throw new Error(String(r.status));
    } catch {
      setStatus('offline');
    } finally {
      emVoo.current = false;
      if (pendente.current) void salvar();
    }
  }, [planId]);

  useEffect(() => {
    if (edicoes === 0) return;
    setStatus('salvando');
    const t = setTimeout(() => void salvar(), ESPERA_MS);
    return () => clearTimeout(t);
  }, [edicoes, salvar]);

  useEffect(() => {
    if (status !== 'offline') return;
    const repetir = () => void salvar();
    const t = setInterval(repetir, REPETIR_MS);
    window.addEventListener('online', repetir);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', repetir);
    };
  }, [status, salvar]);

  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => {
      if (status !== 'salvo' && status !== 'conflito') e.preventDefault();
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [status]);

  return { status, erros, mensagem: MENSAGEM[status] };
}
```

- [ ] **Step 5: Componentes do editor**

`src/app/painel/planos/editor/painel-totais.tsx`:

```tsx
'use client';

import { distribuicaoMacros, gTexto, indicadorMeta, kcalTexto, type Nutrientes } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { formatarDecimal } from '@/lib/numero';

const COR = { verde: 'bg-emerald-100 text-emerald-900', amarelo: 'bg-amber-100 text-amber-900', vermelho: 'bg-red-100 text-red-900' } as const;

/** US-022: total do dia × meta (RN-02, com texto, não só cor) e distribuição de macros. */
export function PainelTotais({ total, meta, pesoKg, mostrarGkg }: { total: Nutrientes; meta: number | null; pesoKg: number | null; mostrarGkg: boolean }) {
  const ind = indicadorMeta(total.kcal, meta);
  const d = distribuicaoMacros(total, pesoKg);
  const linha = (rotulo: string, m: { g: number; gPorKg: number | null; pctVet: number | null }) => (
    <tr>
      <th scope="row" className="pr-3 text-left font-normal">{rotulo}</th>
      <td>{gTexto(m.g)} g</td>
      {mostrarGkg && <td>{m.gPorKg === null ? '—' : `${formatarDecimal(m.gPorKg, 2)} g/kg`}</td>}
      <td>{m.pctVet === null ? '—' : `${formatarDecimal(m.pctVet, 0)}% do VET`}</td>
    </tr>
  );
  return (
    <section aria-label="Totais do dia" className="space-y-2 rounded border p-3">
      <p className="text-lg">
        Total do dia: <strong>{kcalTexto(total.kcal)} kcal</strong>
        {meta !== null && <> · Meta: {kcalTexto(meta)} kcal</>}
      </p>
      {ind && (
        <p data-testid="indicador-meta" className={`inline-block rounded px-2 py-1 font-semibold ${COR[ind.faixa]}`}>
          {ind.rotulo} ({ind.texto})
        </p>
      )}
      <table className="text-sm">
        <caption className="sr-only">Distribuição de macronutrientes</caption>
        <tbody>
          {linha('Proteína', d.proteina)}
          {linha('Carboidrato', d.carboidrato)}
          {linha('Lipídio', d.lipidio)}
          <tr>
            <th scope="row" className="pr-3 text-left font-normal">Fibra</th>
            <td>{gTexto(d.fibraG)} g</td>
          </tr>
        </tbody>
      </table>
      {mostrarGkg && pesoKg === null && <p className="text-sm text-zinc-600">{MSG_PLANO.semPeso}</p>}
    </section>
  );
}
```

`src/app/painel/planos/editor/editor-plano.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useMemo, useReducer, useRef, type ReactNode } from 'react';
import { BuscaAlimento, Selo } from '@/app/painel/alimentos/busca-alimento';
import { textoMedida } from '@/modules/alimentos/medidas-constantes';
import { diferencaKcal, kcalTexto, nutrientesDoItem, totalDoDia, totalDosItens } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import type { ContextoPaciente } from '@/modules/plano-alimentar/meta';
import type { PlanoCompleto } from '@/modules/plano-alimentar/tipos';
import { casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import { estadoInicial, gramasDoItem, paraEnvio, reduzir, refeicoesParaCalculo, type Acao, type ItemEstado, type RefeicaoEstado } from './estado';
import { PainelTotais } from './painel-totais';
import { useSalvamento } from './use-salvamento';

type Props = { plano: PlanoCompleto; contexto: ContextoPaciente | null; somenteLeitura?: boolean; acoes?: ReactNode };

const novoId = () => crypto.randomUUID(); // D8: gerado no evento, nunca no render

export function EditorPlano({ plano, contexto, somenteLeitura = false, acoes }: Props) {
  const edicoes = useRef(0);
  const [estado, despachar] = useReducer((e: ReturnType<typeof estadoInicial>, a: Acao) => {
    edicoes.current += 1;
    return reduzir(e, a);
  }, plano, estadoInicial);
  const salvamento = useSalvamento(plano.id, plano.revisao, (rev) => paraEnvio(estado, rev), somenteLeitura ? 0 : edicoes.current);
  const total = useMemo(() => totalDoDia(refeicoesParaCalculo(estado)), [estado]);
  const meta = (() => {
    const n = lerDecimal(estado.metaTexto);
    return n === null || Number.isNaN(n) ? null : n;
  })();
  const erro = (chave: string) => salvamento.erros[chave];
  const comPaciente = plano.patientId !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className={`text-sm ${salvamento.status === 'salvo' ? 'text-zinc-600' : 'font-semibold text-amber-800'}`}>
          {somenteLeitura ? `Versão ${plano.versao} · ${plano.status === 'publicado' ? 'Publicado' : 'Arquivado'}` : salvamento.mensagem}
          {salvamento.status === 'conflito' && (
            <button type="button" onClick={() => window.location.reload()} className="ml-2 underline">Recarregar</button>
          )}
        </p>
        {acoes}
      </div>

      <fieldset disabled={somenteLeitura} className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="titulo" className="block font-medium">Título</label>
          <input id="titulo" value={estado.titulo} onChange={(e) => despachar({ tipo: 'titulo', valor: e.target.value })} aria-invalid={erro('titulo') ? true : undefined} className="w-full rounded border p-2" />
          {erro('titulo') && <p role="alert" className="text-sm text-red-700">{erro('titulo')}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="meta" className="block font-medium">Meta (kcal)</label>
          <input id="meta" inputMode="numeric" value={estado.metaTexto} onChange={(e) => despachar({ tipo: 'meta', valor: e.target.value })} aria-invalid={erro('metaKcal') ? true : undefined} className="w-full rounded border p-2" />
          {erro('metaKcal') && <p role="alert" className="text-sm text-red-700">{erro('metaKcal')}</p>}
        </div>
        {comPaciente && contexto && contexto.calculos.length > 0 && (
          <div className="space-y-1 sm:col-span-3">
            <label htmlFor="calculo" className="block font-medium">Usar como meta do plano</label>
            <select
              id="calculo"
              value={estado.energyCalcId ?? ''}
              onChange={(e) => {
                const c = contexto.calculos.find((x) => x.id === e.target.value);
                if (c) despachar({ tipo: 'usarCalculo', id: c.id, kcal: c.kcal });
              }}
              className="w-full rounded border p-2"
            >
              <option value="">Escolha um cálculo de gasto energético…</option>
              {contexto.calculos.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
            </select>
          </div>
        )}
        {comPaciente && (
          <label className="flex items-center gap-2 sm:col-span-3">
            <input type="checkbox" checked={estado.mostrarCalorias} onChange={(e) => despachar({ tipo: 'mostrarCalorias', valor: e.target.checked })} />
            Mostrar calorias ao paciente
          </label>
        )}
      </fieldset>

      <PainelTotais total={total} meta={meta} pesoKg={contexto?.pesoKg ?? null} mostrarGkg={comPaciente} />

      {estado.refeicoes.map((r, k) => (
        <Refeicao key={r.id} r={r} k={k} despachar={despachar} somenteLeitura={somenteLeitura} erro={erro} />
      ))}

      {!somenteLeitura && (
        <button type="button" onClick={() => despachar({ tipo: 'novaRefeicao', id: novoId() })} className="rounded border px-4 py-2">Adicionar refeição</button>
      )}

      <div className="space-y-1">
        <label htmlFor="orientacoes" className="block font-medium">Orientações gerais</label>
        <textarea id="orientacoes" rows={4} disabled={somenteLeitura} value={estado.orientacoes} onChange={(e) => despachar({ tipo: 'orientacoes', valor: e.target.value })} className="w-full rounded border p-2" />
        {erro('orientacoes') && <p role="alert" className="text-sm text-red-700">{erro('orientacoes')}</p>}
      </div>
    </div>
  );
}

function Refeicao({ r, k, despachar, somenteLeitura, erro }: { r: RefeicaoEstado; k: number; despachar: (a: Acao) => void; somenteLeitura: boolean; erro: (c: string) => string | undefined }) {
  const totalRefeicao = totalDosItens(r.itens.map((i) => ({ id: i.id, quantidadeG: gramasDoItem(i), porCem: i.porCem, substituiItemId: i.substituiItemId })));
  const chave = `refeicao:${r.id}`;
  return (
    <section aria-labelledby={`${r.id}-titulo`} className="space-y-3 rounded border p-3">
      <h2 id={`${r.id}-titulo`} className="sr-only">{r.nome || `Refeição ${k + 1}`}</h2>
      <fieldset disabled={somenteLeitura} className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${r.id}-nome`} className="block font-medium">Refeição</label>
          <input id={`${r.id}-nome`} value={r.nome} onChange={(e) => despachar({ tipo: 'refeicao', id: r.id, campo: 'nome', valor: e.target.value })} className="w-full rounded border p-2" />
          {erro(`${chave}:nome`) && <p role="alert" className="text-sm text-red-700">{erro(`${chave}:nome`)}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${r.id}-horario`} className="block font-medium">Horário de {r.nome || 'refeição'}</label>
          <input id={`${r.id}-horario`} type="time" value={r.horario} onChange={(e) => despachar({ tipo: 'refeicao', id: r.id, campo: 'horario', valor: e.target.value })} className="w-full rounded border p-2" />
          {erro(`${chave}:horario`) && <p role="alert" className="text-sm text-red-700">{erro(`${chave}:horario`)}</p>}
        </div>
        <p className="self-end text-sm">Total: {kcalTexto(totalRefeicao.kcal)} kcal</p>
      </fieldset>

      <ul className="space-y-2">
        {r.itens.map((i) => (
          <ItemLinha key={i.id} i={i} principal={r.itens.find((x) => x.id === i.substituiItemId) ?? null} despachar={despachar} somenteLeitura={somenteLeitura} erro={erro} />
        ))}
      </ul>

      {!somenteLeitura && (
        <BuscaAlimento rotulo={`Adicionar alimento em ${r.nome || 'refeição'}`} aoEscolher={(a) => despachar({ tipo: 'adicionarItem', refeicaoId: r.id, id: novoId(), alimento: a })} />
      )}

      <div className="space-y-1">
        <label htmlFor={`${r.id}-obs`} className="block font-medium">Observação</label>
        <textarea id={`${r.id}-obs`} rows={2} disabled={somenteLeitura} value={r.observacao} onChange={(e) => despachar({ tipo: 'refeicao', id: r.id, campo: 'observacao', valor: e.target.value })} className="w-full rounded border p-2" />
      </div>
      {!somenteLeitura && (
        <button type="button" onClick={() => { if (window.confirm(`Remover ${r.nome || 'esta refeição'}?`)) despachar({ tipo: 'removerRefeicao', id: r.id }); }} className="text-sm underline">
          Remover refeição
        </button>
      )}
    </section>
  );
}

function ItemLinha({ i, principal, despachar, somenteLeitura, erro }: { i: ItemEstado; principal: ItemEstado | null; despachar: (a: Acao) => void; somenteLeitura: boolean; erro: (c: string) => string | undefined }) {
  const g = gramasDoItem(i);
  const n = g === null ? null : nutrientesDoItem(i.porCem, g);
  const gp = principal ? gramasDoItem(principal) : null;
  const np = principal && gp !== null ? nutrientesDoItem(principal.porCem, gp) : null;
  const errQ = erro(`item:${i.id}:quantidadeG`) ?? erro(`item:${i.id}:medida`) ?? (g === null ? MSG_PLANO.quantidade : undefined);
  const q = lerDecimal(i.qtdTexto);
  return (
    <li className={`flex flex-wrap items-end gap-3 ${principal ? 'ml-6 border-l-2 pl-3' : ''}`}>
      <div className="min-w-48 flex-1">
        <p className="font-medium">{principal && <span className="text-sm text-zinc-600">ou </span>}{i.nome} <Selo origem={i.origem} /></p>
        {i.medidas.length === 0 && !somenteLeitura && (
          <Link href={`/painel/alimentos/${i.foodId}`} target="_blank" className="text-sm underline">Cadastrar medida caseira</Link>
        )}
      </div>
      <fieldset disabled={somenteLeitura} className="flex flex-wrap items-end gap-2">
        {i.medidas.length > 0 && (
          <div className="space-y-1">
            <label htmlFor={`${i.id}-medida`} className="block text-sm">Medida de {i.nome}</label>
            <select
              id={`${i.id}-medida`}
              value={i.medida?.nome ?? ''}
              onChange={(e) => {
                const m = i.medidas.find((x) => x.nome === e.target.value);
                despachar({ tipo: 'medida', itemId: i.id, medida: m ? { nome: m.nome, plural: m.plural, gramas: m.gramas } : null });
              }}
              className="rounded border p-2"
            >
              <option value="">gramas</option>
              {i.medidas.map((m) => <option key={`${m.origem}-${m.nome}`} value={m.nome}>{m.nome} ({m.gramas} g)</option>)}
            </select>
          </div>
        )}
        {i.medida ? (
          <div className="space-y-1">
            <label htmlFor={`${i.id}-qtd`} className="block text-sm">Quantidade de {i.nome}</label>
            <input id={`${i.id}-qtd`} inputMode="decimal" value={i.qtdTexto} onChange={(e) => despachar({ tipo: 'qtdMedida', itemId: i.id, valor: e.target.value })} aria-invalid={errQ ? true : undefined} aria-describedby={errQ ? `${i.id}-erro` : undefined} className="w-20 rounded border p-2" />
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor={`${i.id}-g`} className="block text-sm">Gramas de {i.nome}</label>
            <input id={`${i.id}-g`} inputMode="decimal" value={i.quantidadeTexto} onChange={(e) => despachar({ tipo: 'quantidade', itemId: i.id, valor: e.target.value })} aria-invalid={errQ ? true : undefined} aria-describedby={errQ ? `${i.id}-erro` : undefined} className="w-24 rounded border p-2" />
          </div>
        )}
      </fieldset>
      <p className="text-sm" data-testid={`kcal-${i.id}`}>
        {i.medida && q !== null && Number.isFinite(q) && q > 0 && g !== null && <span>{textoMedida(q, i.medida)} · {formatarDecimal(g, casasDecimais(g))} g · </span>}
        {n === null ? '—' : n.semValor.includes('kcal') ? MSG_PLANO.semValor : `${kcalTexto(n.kcal)} kcal`}
        {principal && n && np && <span className="ml-1 text-zinc-600">({diferencaKcal(n.kcal, np.kcal)})</span>}
      </p>
      {errQ && <p id={`${i.id}-erro`} role="alert" className="w-full text-sm text-red-700">{errQ}</p>}
      {erro(`item:${i.id}:foodId`) && <p role="alert" className="w-full text-sm text-red-700">{erro(`item:${i.id}:foodId`)}</p>}
      {!somenteLeitura && (
        <div className="flex gap-2 text-sm">
          <button type="button" aria-label={`Subir ${i.nome}`} onClick={() => despachar({ tipo: 'moverItem', itemId: i.id, direcao: -1 })}>↑</button>
          <button type="button" aria-label={`Descer ${i.nome}`} onClick={() => despachar({ tipo: 'moverItem', itemId: i.id, direcao: 1 })}>↓</button>
          <button type="button" className="underline" onClick={() => despachar({ tipo: 'removerItem', itemId: i.id })}>Remover {i.nome}</button>
        </div>
      )}
    </li>
  );
}
```

A substituição já é mostrada recuada, com "ou" e a diferença de kcal; a Tarefa 8 acrescenta o controle para criá-la.

- [ ] **Step 6: Telas do prontuário**

`src/app/painel/pacientes/[id]/plano-alimentar/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { criarRascunho, descartarRascunho } from '@/modules/plano-alimentar/rascunho';

export type AcaoPlanoState = { erro?: string };

export async function criarRascunhoAction(patientId: string, _prev: AcaoPlanoState): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  let id: string;
  try {
    ({ id } = await criarRascunho(ctx, patientId));
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}

export async function descartarRascunhoAction(patientId: string, planId: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  try {
    await descartarRascunho(ctx, planId);
  } catch (e) {
    if (!(e instanceof PlanoNaoEncontradoError || e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar`);
  redirect(`/painel/pacientes/${patientId}/plano-alimentar`);
}
```

`src/app/painel/pacientes/[id]/plano-alimentar/page.tsx`:

```tsx
import Link from 'next/link';
import { formatarData } from '@/modules/pacientes/datas';
import { listarPlanosDoPaciente } from '@/modules/plano-alimentar/carregar';
import { carregarProntuario } from '../prontuario';
import { BotaoAcao } from './botao-acao';
import { criarRascunhoAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS = { rascunho: 'Rascunho', publicado: 'Publicado', arquivado: 'Arquivado' } as const;

export default async function PlanoAlimentarPage({ params }: PageProps<'/painel/pacientes/[id]/plano-alimentar'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const planos = await listarPlanosDoPaciente(ctx, paciente.id);
  const rascunho = planos.find((p) => p.status === 'rascunho');
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Plano alimentar</h2>
      <div className="flex flex-wrap gap-3">
        {rascunho ? (
          <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar/${rascunho.id}`} className="rounded bg-emerald-700 px-4 py-2 text-white">Continuar o rascunho (versão {rascunho.versao})</Link>
        ) : (
          !planos.some((p) => p.status === 'publicado') && <BotaoAcao acao={criarRascunhoAction.bind(null, paciente.id)} rotulo="Criar plano" />
        )}
      </div>
      {planos.length === 0 ? (
        <p>Nenhum plano ainda.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Versões do plano</caption>
          <thead>
            <tr><th scope="col">Versão</th><th scope="col">Título</th><th scope="col">Situação</th><th scope="col">Publicado em</th></tr>
          </thead>
          <tbody>
            {planos.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/painel/pacientes/${paciente.id}/plano-alimentar/${p.id}`} className="underline">Versão {p.versao}</Link></td>
                <td>{p.titulo}</td>
                <td>{STATUS[p.status]}</td>
                <td>{p.publicadoEm ? formatarData(p.publicadoEm.slice(0, 10)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

`src/app/painel/pacientes/[id]/plano-alimentar/botao-acao.tsx` (botão de Server Action que mostra o erro na tela; reaproveitado nas Tarefas 9 e 10):

```tsx
'use client';

import { useActionState } from 'react';
import type { AcaoPlanoState } from './actions';

export function BotaoAcao({ acao, rotulo, confirmar, principal = true }: { acao: (s: AcaoPlanoState) => Promise<AcaoPlanoState>; rotulo: string; confirmar?: string; principal?: boolean }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} onSubmit={(e) => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }} className="space-y-1">
      <button disabled={pendente} className={principal ? 'rounded bg-emerald-700 px-4 py-2 text-white' : 'rounded border px-4 py-2'}>{rotulo}</button>
      {state.erro && <p role="alert" className="text-sm text-red-700">{state.erro}</p>}
    </form>
  );
}
```

`src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EditorPlano } from '@/app/painel/planos/editor/editor-plano';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { carregarPlano } from '@/modules/plano-alimentar/carregar';
import { contextoDoPaciente } from '@/modules/plano-alimentar/meta';
import { carregarProntuario } from '../../prontuario';
import { descartarRascunhoAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlanoPage({ params }: PageProps<'/painel/pacientes/[id]/plano-alimentar/[planId]'>) {
  const { id, planId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const plano = await carregarPlano(ctx, planId);
  if (!plano || plano.patientId !== paciente.id) notFound();
  const rascunho = plano.status === 'rascunho';
  const contexto = await contextoDoPaciente(ctx, paciente.id, tenant.fuso);
  return (
    <section className="space-y-4">
      <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar`} className="text-sm underline">Voltar às versões</Link>
      <h2 className="text-xl font-semibold">Plano alimentar — versão {plano.versao}</h2>
      <EditorPlano
        plano={plano}
        contexto={contexto}
        somenteLeitura={!rascunho}
        acoes={
          rascunho && (
            <form action={descartarRascunhoAction.bind(null, paciente.id, plano.id)}>
              <ConfirmarBotao mensagem="Descartar este rascunho?">Descartar rascunho</ConfirmarBotao>
            </form>
          )
        }
      />
    </section>
  );
}
```

Em `src/app/painel/pacientes/[id]/abas.tsx`, antes de `historico`: `{ seg: 'plano-alimentar', rotulo: 'Plano alimentar' },`.

- [ ] **Step 7: E2E** — acrescentar a `e2e/plano-alimentar.spec.ts` (imports: `randomUUID` não é preciso; o paciente é criado pela tela):

```ts
let prontuario = '';
let editor = '';
const ALIMENTO_130 = `Alimento 130 ${sufixo}`;

test('editor: cálculo ao vivo, medida caseira, meta por faixa e salvamento automático com aviso offline (US-022, US-020)', async () => {
  // Alimento de 130 kcal/100 g (cenário "Cálculo do item")
  await nutri.goto('/painel/alimentos/novo');
  await nutri.getByLabel('Nome').fill(ALIMENTO_130);
  await nutri.getByLabel('Grupo').selectOption('Miscelâneas');
  for (const [rotulo, v] of [['Energia (kcal)', '130'], ['Proteína (g)', '10'], ['Carboidrato (g)', '15'], ['Lipídio (g)', '3'], ['Fibra (g)', '1']] as const) await nutri.getByLabel(rotulo).fill(v);
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByRole('heading', { name: ALIMENTO_130 })).toBeVisible();

  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(`Paciente Plano ${sufixo}`);
  await nutri.getByLabel('Data de nascimento').fill('1991-03-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(`plano-${sufixo}@nutridebby.test`);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: `Paciente Plano ${sufixo}` })).toBeVisible();
  prontuario = new URL(nutri.url()).pathname;

  await nutri.goto(`${prontuario}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: 'Plano alimentar — versão 1' })).toBeVisible();
  editor = new URL(nutri.url()).pathname;

  await nutri.getByLabel('Meta (kcal)').fill('200');
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).fill('Almoço');
  await nutri.getByLabel('Horário de Almoço').fill('12:00');
  await nutri.getByLabel('Adicionar alimento em Almoço').fill(ALIMENTO_130);
  await nutri.getByRole('option', { name: new RegExp(ALIMENTO_130) }).click();
  await nutri.getByLabel(`Gramas de ${ALIMENTO_130}`).fill('150');
  await expect(nutri.getByText('Total do dia: 195 kcal')).toBeVisible(); // 130 × 150 / 100
  await expect(nutri.getByTestId('indicador-meta')).toHaveText('Dentro da meta (−2,5%)'); // 195 × 200

  // Medida caseira do seed IBGE: arroz, 4 colheres de sopa cheias = 100 g = 128 kcal
  await nutri.getByLabel('Adicionar alimento em Almoço').fill('arroz tipo 1 cozido');
  await nutri.getByRole('option', { name: /Arroz, tipo 1, cozido/ }).click();
  await nutri.getByLabel('Quantidade de Arroz, tipo 1, cozido').fill('4');
  await expect(nutri.getByText('4 colheres de sopa cheias · 100 g · 128 kcal')).toBeVisible();
  await expect(nutri.getByTestId('indicador-meta')).toHaveText('Fora da meta (+61,5%)'); // 323 × 200
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });

  await nutri.reload();
  await expect(nutri.getByLabel(`Gramas de ${ALIMENTO_130}`)).toHaveValue('150');
  await expect(nutri.getByText('Total do dia: 323 kcal')).toBeVisible();

  // "se a conexão cair, vejo 'Alterações não salvas' e o salvamento é repetido quando a conexão voltar"
  await nutri.context().setOffline(true);
  await nutri.getByLabel(`Gramas de ${ALIMENTO_130}`).fill('100');
  await expect(nutri.getByRole('status').filter({ hasText: 'Alterações não salvas' })).toBeVisible({ timeout: 5000 });
  await nutri.context().setOffline(false);
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10000 });
  await nutri.reload();
  await expect(nutri.getByLabel(`Gramas de ${ALIMENTO_130}`)).toHaveValue('100');
});
```

Run: `pnpm build && pnpm test:e2e e2e/plano-alimentar.spec.ts` → PASS.

- [ ] **Step 8: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/modules/plano-alimentar src/app/painel/planos src/app/painel/pacientes e2e/plano-alimentar.spec.ts
git commit -m "feat(plano-alimentar): editor com cálculo ao vivo, medidas caseiras, meta do gasto energético, macros e salvamento automático com aviso offline (P04-05c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Substituições por item, com kcal própria e diferença para o principal (P04-06)

**Files:**
- Modify: `src/app/painel/planos/editor/estado.ts`, `src/app/painel/planos/editor/estado.test.ts`, `src/app/painel/planos/editor/editor-plano.tsx`, `e2e/plano-alimentar.spec.ts`

**Interfaces:**
- Consumes: `reduzir`, `Acao` `adicionarItem` com `substituiItemId` (Tarefa 7); `BuscaAlimento` (Tarefa 3); `diferencaKcal`, `totalDosItens` (Tarefa 5); validação de substituição no servidor (Tarefa 6).
- Produces: substituição inserida logo depois do seu principal (e das substituições que ele já tem); controle "Adicionar substituição para {alimento}" em cada item principal.

- [ ] **Step 1: Teste (falha)** — acrescentar a `src/app/painel/planos/editor/estado.test.ts`:

```ts
  it('"Grupo de substituição": tapioca e cuscuz entram logo depois do pão e não somam no total (US-023, RN-02)', () => {
    const pao = { ...arroz, id: 'f-pao', nome: 'Pão, trigo, francês', porCem: { kcal: 300, proteinaG: 8, carboidratoG: 58.6, lipidioG: 3.1, fibraG: 2.3 }, medidas: [] };
    const tapioca = { ...proprio, id: 'f-tap', nome: 'Tapioca, com manteiga', porCem: { kcal: 348, proteinaG: 0.1, carboidratoG: 63.6, lipidioG: 10.9, fibraG: 0 } };
    const cuscuz = { ...proprio, id: 'f-cus', nome: 'Cuscuz, de milho, cozido com sal', porCem: { kcal: 113, proteinaG: 2.2, carboidratoG: 25.3, lipidioG: 0.7, fibraG: 2.1 } };
    const e = aplicar(
      estadoInicial(plano),
      { tipo: 'novaRefeicao', id: 'r1' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'pao', alimento: pao },
      { tipo: 'quantidade', itemId: 'pao', valor: '50' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'cafe', alimento: proprio },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'tap', alimento: tapioca, substituiItemId: 'pao' },
      { tipo: 'quantidade', itemId: 'tap', valor: '40' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'cus', alimento: cuscuz, substituiItemId: 'pao' },
    );
    expect(e.refeicoes[0].itens.map((i) => i.id)).toEqual(['pao', 'tap', 'cus', 'cafe']);
    expect(totalDoDia(refeicoesParaCalculo(e)).kcal).toBe(280); // pão 150 + item de 130 kcal com 100 g; substituições fora
    expect(paraEnvio(e, 0).refeicoes[0].itens.filter((i) => i.substituiItemId === 'pao').map((i) => i.id)).toEqual(['tap', 'cus']);
  });
```

Run: `pnpm test src/app/painel/planos/editor/estado.test.ts`
Expected: FAIL — a ordem sai `['pao', 'cafe', 'tap', 'cus']`.

- [ ] **Step 2: Implementar** — em `estado.ts`, no `case 'adicionarItem'`, trocar o `return` por:

```ts
      return {
        ...e,
        refeicoes: e.refeicoes.map((r) => {
          if (r.id !== a.refeicaoId) return r;
          if (!novo.substituiItemId) return { ...r, itens: [...r.itens, novo] };
          // US-023: a substituição fica junto do principal (depois das que ele já tem)
          const k = r.itens.findIndex((i) => i.id === novo.substituiItemId);
          if (k < 0) return r;
          let fim = k + 1;
          while (fim < r.itens.length && r.itens[fim].substituiItemId === novo.substituiItemId) fim++;
          return { ...r, itens: [...r.itens.slice(0, fim), novo, ...r.itens.slice(fim)] };
        }),
      };
```

Em `editor-plano.tsx`:
- `Refeicao` passa `refeicaoId={r.id}` para cada `ItemLinha`.
- `ItemLinha` recebe `refeicaoId: string`, ganha `const [substituindo, setSubstituindo] = useState(false);` (import `useState`) e, dentro do `<li>`, depois do bloco de botões:

```tsx
      {!somenteLeitura && !principal && (
        <div className="w-full">
          <button type="button" className="text-sm underline" aria-expanded={substituindo} onClick={() => setSubstituindo((v) => !v)}>
            Adicionar substituição para {i.nome}
          </button>
          {substituindo && (
            <BuscaAlimento
              rotulo={`Substituição para ${i.nome}`}
              aoEscolher={(a) => {
                despachar({ tipo: 'adicionarItem', refeicaoId, id: novoId(), alimento: a, substituiItemId: i.id });
                setSubstituindo(false);
              }}
            />
          )}
        </div>
      )}
```

Run: `pnpm test src/app/painel/planos/editor/estado.test.ts` → PASS.

- [ ] **Step 3: E2E** — acrescentar a `e2e/plano-alimentar.spec.ts`:

```ts
test('substituições: ligadas ao principal, fora do total, com kcal própria e diferença (US-023)', async () => {
  await nutri.goto(editor);
  const totalAntes = await nutri.getByText(/^Total do dia: \d+ kcal/).textContent();
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).last().fill('Café da manhã');
  await nutri.getByLabel('Horário de Café da manhã').fill('07:30');
  await nutri.getByLabel('Adicionar alimento em Café da manhã').fill('pao trigo frances');
  await nutri.getByRole('option', { name: /^Pão, trigo, francês/ }).click();
  await expect(nutri.getByText('1 unidade · 50 g · 150 kcal')).toBeVisible(); // seed IBGE: pão francês, unidade = 50 g
  const totalComPao = await nutri.getByText(/^Total do dia: \d+ kcal/).textContent();
  expect(totalComPao).not.toBe(totalAntes);

  await nutri.getByRole('button', { name: 'Adicionar substituição para Pão, trigo, francês' }).click();
  await nutri.getByLabel('Substituição para Pão, trigo, francês').fill('tapioca com manteiga');
  await nutri.getByRole('option', { name: /Tapioca, com manteiga/ }).click();
  await nutri.getByLabel('Gramas de Tapioca, com manteiga').fill('40');
  await expect(nutri.getByText('139 kcal (−11 kcal)')).toBeVisible(); // 348 × 0,4 = 139; 139 − 150
  await expect(nutri.getByText(/^Total do dia: \d+ kcal/)).toHaveText(totalComPao!); // a substituição não soma (RN-02)
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });
});
```

Run: `pnpm build && pnpm test:e2e e2e/plano-alimentar.spec.ts` → PASS.

- [ ] **Step 4: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/app/painel/planos/editor e2e/plano-alimentar.spec.ts
git commit -m "feat(plano-alimentar): substituições ligadas ao item principal, fora do total e com diferença de kcal (P04-06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Modelos de plano — criar, editar, "Salvar como modelo" e "Criar a partir de modelo" (P04-07)

**Files:**
- Create: `src/modules/plano-alimentar/modelos.ts`, `src/modules/plano-alimentar/modelos.test.ts`, `src/app/painel/planos/modelos/page.tsx`, `src/app/painel/planos/modelos/novo-modelo.tsx`, `src/app/painel/planos/modelos/actions.ts`, `src/app/painel/planos/modelos/[id]/page.tsx`, `src/app/painel/planos/salvar-como-modelo.tsx`, `src/app/painel/pacientes/[id]/plano-alimentar/criar-de-modelo.tsx`
- Modify: `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx`, `src/app/painel/pacientes/[id]/plano-alimentar/actions.ts`, `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx`, `src/app/painel/cabecalho.tsx`, `e2e/plano-alimentar.spec.ts`

**Interfaces:**
- Consumes: `copiarConteudo`, `proximaVersao`, `salvarRascunho` (Tarefa 6); `carregarPlano`, `PlanoError`, `PlanoNaoEncontradoError`, `MSG_PLANO` (Tarefas 5–6); `EditorPlano`, `BotaoAcao`, `AcaoPlanoState` (Tarefa 7); `carregarPacienteParaEscrita`, `auditRead`, `normalizarTexto`.
- Produces: `@/modules/plano-alimentar/modelos`: `criarModelo(ctx, titulo, deps?): Promise<{ id }>`, `listarModelos(ctx, db?): Promise<{ id; titulo; refeicoes: number; atualizadoEm: string }[]>`, `salvarComoModelo(ctx, planId, titulo, deps?): Promise<{ id }>`, `criarDeModelo(ctx, modeloId, patientId, deps?): Promise<{ id }>`, `excluirModelo(ctx, id, deps?): Promise<void>`.

- [ ] **Step 1: Testes (falham)** — `src/modules/plano-alimentar/modelos.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError } from './erros';
import { criarDeModelo, criarModelo, excluirModelo, listarModelos, salvarComoModelo } from './modelos';
import { criarRascunho, salvarRascunho } from './rascunho';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const conteudo = (revisao: number, titulo = 'Emagrecimento 1600 kcal') => ({
  revisao, titulo, metaKcal: '1600', mostrarCalorias: false, orientacoes: 'Evitar frituras.',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [
    { id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 }, substituiItemId: null },
    { id: randomUUID(), foodId: idTaco(561), quantidadeG: '140', medida: null, substituiItemId: null },
  ] }],
});

describe('modelos de plano (US-024)', () => {
  it('"Criar a partir de modelo": rascunho de Ana com as mesmas refeições e itens; alterar o de Ana não altera o modelo', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id: modelo } = await criarModelo(T.ctx, 'Emagrecimento 1600 kcal', deps);
    await salvarRascunho(T.ctx, modelo, conteudo(0), deps);
    expect(await listarModelos(T.ctx, app.db)).toMatchObject([{ id: modelo, titulo: 'Emagrecimento 1600 kcal', refeicoes: 1 }]);

    const { id } = await criarDeModelo(T.ctx, modelo, ana.id, deps);
    const deAna = await carregarPlano(T.ctx, id, app.db);
    expect(deAna).toMatchObject({ patientId: ana.id, status: 'rascunho', versao: 1, titulo: 'Emagrecimento 1600 kcal', metaKcal: 1600, orientacoes: 'Evitar frituras.' });
    expect(deAna!.refeicoes[0].itens.map((i) => [i.nome, i.quantidadeG, i.medidaCaseiraTxt])).toEqual([
      ['Arroz, tipo 1, cozido', 100, '4 colheres de sopa cheias'],
      ['Feijão, carioca, cozido', 140, null],
    ]);
    await salvarRascunho(T.ctx, id, { ...conteudo(deAna!.revisao, 'Plano de Ana'), refeicoes: [] }, deps);
    const m = await carregarPlano(T.ctx, modelo, app.db);
    expect(m).toMatchObject({ titulo: 'Emagrecimento 1600 kcal', isTemplate: true, patientId: null });
    expect(m!.refeicoes[0].itens).toHaveLength(2);
  });

  it('"Salvar plano como modelo": cópia com is_template e patient_id nulo', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, ana.id, deps);
    await salvarRascunho(T.ctx, id, conteudo(0, 'Plano de Ana'), deps);
    const { id: modelo } = await salvarComoModelo(T.ctx, id, '  Hipertrofia  ', deps);
    expect(await carregarPlano(T.ctx, modelo, app.db)).toMatchObject({ isTemplate: true, patientId: null, status: 'rascunho', titulo: 'Hipertrofia', mostrarCalorias: false });
    expect((await carregarPlano(T.ctx, modelo, app.db))!.refeicoes[0].itens).toHaveLength(2);
    await expect(salvarComoModelo(T.ctx, id, ' ', deps)).rejects.toEqual(new PlanoError({ titulo: MSG_PLANO.titulo }));
  });

  it('paciente com rascunho não recebe outro a partir de modelo; modelo é invisível para outro tenant e para a sessão do paciente', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, A.ctx);
    const { id: modelo } = await criarModelo(A.ctx, 'Base', deps);
    await criarRascunho(A.ctx, ana.id, deps);
    await expect(criarDeModelo(A.ctx, modelo, ana.id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.rascunhoExiste }));
    expect(await listarModelos(B.ctx, app.db)).toEqual([]);
    expect(await carregarPlano(B.ctx, modelo, app.db)).toBeNull();
    const comoAna = await withTenant(ctxPaciente(A.tenantId, ana.id), (tx) => tx.execute(sql`select id from meal_plans where is_template`), app.db);
    expect(comoAna.rows).toHaveLength(0);
    await excluirModelo(A.ctx, modelo, deps);
    expect(await listarModelos(A.ctx, app.db)).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/modelos.test.ts` → FAIL (`Cannot find module './modelos'`).

- [ ] **Step 2: Implementar** — `src/modules/plano-alimentar/modelos.ts`

```ts
import { and, count, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans, meals } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEncontradoError } from './erros';
import { copiarConteudo, proximaVersao } from './rascunho';

type Deps = { db?: Db };

function titulo(v: unknown): string {
  const t = normalizarTexto(v);
  if (!t || t.length > 120) throw new PlanoError({ titulo: MSG_PLANO.titulo });
  return t;
}

export async function criarModelo(ctx: TenantContext, tituloEntrada: unknown, deps: Deps = {}): Promise<{ id: string }> {
  const t = titulo(tituloEntrada);
  const [m] = await withTenant(ctx, (tx) => tx.insert(mealPlans).values({ tenantId: ctx.tenantId, isTemplate: true, titulo: t }).returning({ id: mealPlans.id }), deps.db ?? getDb());
  return m;
}

export async function listarModelos(ctx: TenantContext, db: Db = getDb()) {
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: mealPlans.id, titulo: mealPlans.titulo, atualizadoEm: mealPlans.updatedAt, refeicoes: count(meals.id) })
        .from(mealPlans)
        .leftJoin(meals, eq(meals.planId, mealPlans.id))
        .where(eq(mealPlans.isTemplate, true))
        .groupBy(mealPlans.id)
        .orderBy(desc(mealPlans.updatedAt));
      return r.map((x) => ({ ...x, atualizadoEm: x.atualizadoEm.toISOString() }));
    },
    db,
  );
}

/** US-024 "Salvar plano como modelo": copia refeições e itens para um modelo novo (sem paciente). */
export async function salvarComoModelo(ctx: TenantContext, planId: string, tituloEntrada: unknown, deps: Deps = {}): Promise<{ id: string }> {
  const t = titulo(tituloEntrada);
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId));
      if (!p) throw new PlanoNaoEncontradoError();
      if (p.patientId) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: p.patientId }); // copiar lê o plano do paciente
      const [m] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, isTemplate: true, titulo: t, metaKcal: p.metaKcal, orientacoes: p.orientacoes, origemPlanId: p.id })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, p.id, { id: m.id, patientId: null, tenantId: ctx.tenantId });
      return m;
    },
    deps.db ?? getDb(),
  );
}

/** US-024 "Criar a partir de modelo": rascunho novo do paciente (D11: só se ele não tiver rascunho). */
export async function criarDeModelo(ctx: TenantContext, modeloId: string, patientId: string, deps: Deps = {}): Promise<{ id: string }> {
  if (!idValido(modeloId)) throw new PlanoNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const [m] = await tx.select().from(mealPlans).where(and(eq(mealPlans.id, modeloId), eq(mealPlans.isTemplate, true)));
      if (!m) throw new PlanoNaoEncontradoError();
      const [existe] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'rascunho')));
      if (existe) throw new PlanoError({ geral: MSG_PLANO.rascunhoExiste });
      const [p] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, patientId, titulo: m.titulo, metaKcal: m.metaKcal, orientacoes: m.orientacoes, origemPlanId: m.id, versao: await proximaVersao(tx, patientId) })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, m.id, { id: p.id, patientId, tenantId: ctx.tenantId });
      return p;
    },
    deps.db ?? getDb(),
  );
}

export async function excluirModelo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new PlanoNaoEncontradoError();
  const r = await withTenant(ctx, (tx) => tx.delete(mealPlans).where(and(eq(mealPlans.id, id), eq(mealPlans.isTemplate, true))).returning({ id: mealPlans.id }), deps.db ?? getDb());
  if (!r.length) throw new PlanoNaoEncontradoError();
}
```

Run: `pnpm test src/modules/plano-alimentar/modelos.test.ts` → PASS (3 testes).

- [ ] **Step 3: Telas**

`src/app/painel/planos/modelos/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { PlanoError, PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { criarDeModelo, criarModelo, excluirModelo, salvarComoModelo } from '@/modules/plano-alimentar/modelos';

export type ModeloState = { erro?: string; ok?: string };
const mensagem = (e: PlanoError) => Object.values(e.erros)[0];

export async function criarModeloAction(_prev: ModeloState, fd: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri('/painel/planos/modelos');
  let id: string;
  try {
    ({ id } = await criarModelo(ctx, fd.get('titulo')));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: mensagem(e) };
    throw e;
  }
  redirect(`/painel/planos/modelos/${id}`);
}

export async function excluirModeloAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/planos/modelos/${id}`);
  try {
    await excluirModelo(ctx, id);
  } catch (e) {
    if (!(e instanceof PlanoNaoEncontradoError)) throw e;
  }
  revalidatePath('/painel/planos/modelos');
  redirect('/painel/planos/modelos');
}

export async function salvarComoModeloAction(planId: string, _prev: ModeloState, fd: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri('/painel/planos/modelos');
  try {
    await salvarComoModelo(ctx, planId, fd.get('titulo'));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: mensagem(e) };
    if (e instanceof PlanoNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath('/painel/planos/modelos');
  return { ok: 'Modelo salvo.' };
}

export async function criarDeModeloAction(patientId: string, _prev: ModeloState, fd: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  let id: string;
  try {
    ({ id } = await criarDeModelo(ctx, String(fd.get('modelo') ?? ''), patientId));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: mensagem(e) };
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}
```

`src/app/painel/planos/salvar-como-modelo.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { ModeloState } from './modelos/actions';

/** US-024 "Salvar como modelo" (disponível em qualquer versão do plano). */
export function SalvarComoModelo({ acao, tituloSugerido }: { acao: (s: ModeloState, fd: FormData) => Promise<ModeloState>; tituloSugerido: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="titulo-modelo" className="block text-sm">Nome do modelo</label>
        <input id="titulo-modelo" name="titulo" defaultValue={tituloSugerido} className="rounded border p-2" />
      </div>
      <button disabled={pendente} className="rounded border px-4 py-2">Salvar como modelo</button>
      {state.erro && <p role="alert" className="w-full text-sm text-red-700">{state.erro}</p>}
      {state.ok && <p role="status" className="w-full text-sm text-emerald-800">{state.ok}</p>}
    </form>
  );
}
```

`src/app/painel/planos/modelos/page.tsx`:

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { formatarData } from '@/modules/pacientes/datas';
import { listarModelos } from '@/modules/plano-alimentar/modelos';
import { NovoModelo } from './novo-modelo';

export const dynamic = 'force-dynamic';

export default async function ModelosPage() {
  const { ctx } = await requireNutri('/painel/planos/modelos');
  const modelos = await listarModelos(ctx);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Modelos de plano</h1>
      <NovoModelo />
      {modelos.length === 0 ? (
        <p>Nenhum modelo ainda. Crie um aqui ou use "Salvar como modelo" em um plano.</p>
      ) : (
        <ul className="divide-y rounded border">
          {modelos.map((m) => (
            <li key={m.id} className="flex justify-between p-2">
              <Link href={`/painel/planos/modelos/${m.id}`} className="underline">{m.titulo}</Link>
              <span className="text-sm text-zinc-600">{m.refeicoes} refeições · alterado em {formatarData(m.atualizadoEm.slice(0, 10))}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`src/app/painel/planos/modelos/novo-modelo.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { criarModeloAction } from './actions';

export function NovoModelo() {
  const [state, action, pendente] = useActionState(criarModeloAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="titulo" className="block font-medium">Novo modelo</label>
        <input id="titulo" name="titulo" placeholder="Emagrecimento 1600 kcal" className="rounded border p-2" />
      </div>
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Criar modelo</button>
      {state.erro && <p role="alert" className="w-full text-sm text-red-700">{state.erro}</p>}
    </form>
  );
}
```

`src/app/painel/planos/modelos/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { carregarPlano } from '@/modules/plano-alimentar/carregar';
import { EditorPlano } from '../../editor/editor-plano';
import { excluirModeloAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ModeloPage({ params }: PageProps<'/painel/planos/modelos/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/planos/modelos/${id}`);
  const modelo = await carregarPlano(ctx, id);
  if (!modelo || !modelo.isTemplate) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <Link href="/painel/planos/modelos" className="text-sm underline">Voltar aos modelos</Link>
      <h1 className="text-2xl font-semibold">Modelo: {modelo.titulo}</h1>
      <EditorPlano
        plano={modelo}
        contexto={null}
        acoes={
          <form action={excluirModeloAction.bind(null, modelo.id)}>
            <ConfirmarBotao mensagem="Excluir este modelo? Os planos criados a partir dele não mudam.">Excluir modelo</ConfirmarBotao>
          </form>
        }
      />
    </main>
  );
}
```

Na tela de versões do paciente (`plano-alimentar/page.tsx`), quando **não** há rascunho, acrescentar ao lado de "Criar plano" (carregue `listarModelos(ctx)` na página):

```tsx
        {!rascunho && modelos.length > 0 && <CriarDeModelo acao={criarDeModeloAction.bind(null, paciente.id)} modelos={modelos} />}
```

com `src/app/painel/pacientes/[id]/plano-alimentar/criar-de-modelo.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { ModeloState } from '@/app/painel/planos/modelos/actions';

export function CriarDeModelo({ acao, modelos }: { acao: (s: ModeloState, fd: FormData) => Promise<ModeloState>; modelos: { id: string; titulo: string }[] }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="modelo" className="block text-sm">Modelo</label>
        <select id="modelo" name="modelo" className="rounded border p-2">
          {modelos.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
        </select>
      </div>
      <button disabled={pendente} className="rounded border px-4 py-2">Criar a partir de modelo</button>
      {state.erro && <p role="alert" className="w-full text-sm text-red-700">{state.erro}</p>}
    </form>
  );
}
```

"Criar plano" continua só para quem não tem plano publicado (com publicado, o caminho é "Editar", Tarefa 10). "Criar a partir de modelo" aparece sempre que não há rascunho: com plano publicado, o rascunho criado vira a próxima versão (`proximaVersao`) e publicar arquiva a anterior normalmente.

Na tela do plano (`[planId]/page.tsx`), dentro de `acoes`, ao lado do descarte: `<SalvarComoModelo acao={salvarComoModeloAction.bind(null, plano.id)} tituloSugerido={plano.titulo} />` (vale para rascunho, publicado e arquivado; envolva os dois em `<div className="flex flex-wrap gap-4">`).

Em `src/app/painel/cabecalho.tsx`, depois de `Alimentos`: `<Link href="/painel/planos/modelos">Modelos de plano</Link>`.

- [ ] **Step 4: E2E** — acrescentar a `e2e/plano-alimentar.spec.ts`:

```ts
test('salvar como modelo e abrir o modelo (US-024)', async () => {
  await nutri.goto(editor);
  await nutri.getByLabel('Nome do modelo').fill(`Modelo ${sufixo}`);
  await nutri.getByRole('button', { name: 'Salvar como modelo' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Modelo salvo.' })).toBeVisible();
  await nutri.goto('/painel/planos/modelos');
  await nutri.getByRole('link', { name: `Modelo ${sufixo}` }).click();
  await expect(nutri.getByRole('heading', { name: `Modelo: Modelo ${sufixo}` })).toBeVisible();
  await expect(nutri.getByLabel('Refeição', { exact: true }).first()).toHaveValue('Almoço');
  await expect(nutri.getByText('Mostrar calorias ao paciente')).toHaveCount(0); // modelo não tem paciente
});
```

Run: `pnpm build && pnpm test:e2e e2e/plano-alimentar.spec.ts` → PASS.

- [ ] **Step 5: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/modules/plano-alimentar src/app/painel/planos src/app/painel/pacientes src/app/painel/cabecalho.tsx e2e/plano-alimentar.spec.ts
git commit -m "feat(plano-alimentar): modelos de plano — salvar como modelo e criar a partir de modelo (P04-07)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Publicação e versionamento — 1 publicado por paciente, nutrientes congelados, "Editar" cria a próxima versão (P04-08)

**Files:**
- Create: `src/modules/plano-alimentar/publicacao.ts`, `src/modules/plano-alimentar/publicacao.test.ts`
- Modify: `src/jobs/queues.ts` (fila `plano-pdf`), `src/app/painel/pacientes/[id]/plano-alimentar/actions.ts`, `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx`, `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx`, `e2e/plano-alimentar.spec.ts`

**Interfaces:**
- Consumes: `lerPlanoNaTransacao`, `copiarConteudo`, `proximaVersao`, `PlanoError`, `PlanoNaoEditavelError`, `PlanoNaoEncontradoError`, `MSG_PLANO` (Tarefas 5–6); `carregarPacienteParaEscrita`; `getBoss` (`@/jobs/boss`), `fromDrizzle` (`pg-boss`); `BotaoAcao`, `AcaoPlanoState` (Tarefa 7); `criarAlimento`, `editarAlimento`, `excluirAlimento`, `MSG_ALIMENTO` (Tarefa 4).
- Produces:
  - Fila `plano-pdf` (payload `{ tenantId: string; planId: string }`), consumida pelo worker na Tarefa 11.
  - `@/modules/plano-alimentar/publicacao`: `publicarPlano(ctx, planId, deps?: { db?; now?; boss? }): Promise<{ versao: number }>`, `editarPublicado(ctx, planId, deps?): Promise<{ id: string; criado: boolean }>`.

- [ ] **Step 1: Fila** — em `src/jobs/queues.ts`, no `QUEUES`:

```ts
  /** US-026: PDF do plano gerado pelo worker na publicação (≤ 30 s). Payload { tenantId, planId }. */
  'plano-pdf': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
```

Run: `pnpm test src/jobs` → PASS (`ensureQueues` cria a fila nova).

- [ ] **Step 2: Testes (falham)** — `src/modules/plano-alimentar/publicacao.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { mealPlans, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { criarAlimento, editarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { idTaco } from '@/modules/alimentos/taco';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEditavelError } from './erros';
import { criarModelo } from './modelos';
import { editarPublicado, publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const deps = { db: app.db, now: new Date('2026-10-01T15:00:00Z') };

const item = (foodId: string, quantidadeG = '100') => ({ id: randomUUID(), foodId, quantidadeG, medida: null, substituiItemId: null });
const corpo = (revisao: number, itens = [item(idTaco(3))], horario = '12:00') => ({
  revisao, titulo: 'Plano de Ana', metaKcal: '2000', mostrarCalorias: false, orientacoes: '',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario, observacao: '', itens }],
});

async function publicado(T: TenantDeTeste, itens = [item(idTaco(3))]) {
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  await salvarRascunho(T.ctx, id, corpo(0, itens), deps);
  await publicarPlano(T.ctx, id, deps);
  return { p, id };
}

const jobsDoPlano = async (planId: string) =>
  Number((await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [planId])).rows[0].n);

describe('publicação e versionamento (US-025, RN-01)', () => {
  it('"Primeira publicação": status publicado, versão 1, PDF pendente e job na fila na mesma transação', async () => {
    const T = await novoTenant(app.db);
    const { id } = await publicado(T);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ status: 'publicado', versao: 1, publicadoEm: '2026-10-01T15:00:00.000Z', pdfStatus: 'pendente', pdfPath: null });
    expect(await jobsDoPlano(id)).toBe(1);
  });

  it('"Nova versão arquiva a anterior": Editar cria o rascunho v2, a v1 segue publicada; publicar a v2 arquiva a v1', async () => {
    const T = await novoTenant(app.db);
    const { p, id: v1 } = await publicado(T);
    const { id: v2, criado } = await editarPublicado(T.ctx, v1, deps);
    expect(criado).toBe(true);
    expect(await editarPublicado(T.ctx, v1, deps)).toEqual({ id: v2, criado: false });
    const rasc = await carregarPlano(T.ctx, v2, app.db);
    expect(rasc).toMatchObject({ status: 'rascunho', versao: 2, titulo: 'Plano de Ana' });
    expect(rasc!.refeicoes[0].itens).toHaveLength(1);
    expect((await carregarPlano(T.ctx, v1, app.db))?.status).toBe('publicado');
    await publicarPlano(T.ctx, v2, deps);
    expect((await carregarPlano(T.ctx, v1, app.db))?.status).toBe('arquivado');
    expect((await carregarPlano(T.ctx, v2, app.db))?.status).toBe('publicado');
    const publicados = await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(and(eq(mealPlans.patientId, p.id), eq(mealPlans.status, 'publicado'))), app.db);
    expect(publicados).toHaveLength(1);
  });

  it('"o banco nunca tem 2 planos publicados para P": o índice único parcial recusa', async () => {
    const T = await novoTenant(app.db);
    const { p } = await publicado(T);
    await expect(
      withTenant(T.ctx, (tx) => tx.insert(mealPlans).values({ tenantId: T.tenantId, patientId: p.id, titulo: 'Duplo', status: 'publicado', versao: 9 }), app.db),
    ).rejects.toSatisfy((e: unknown) => uniqueViolation(e) === 'meal_plans_um_publicado_idx');
  });

  it('só publica plano com refeição, horário e alimento em toda refeição', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    await expect(publicarPlano(T.ctx, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.publicarVazio }));
    await salvarRascunho(T.ctx, id, corpo(0, [item(idTaco(3))], ''), deps);
    await expect(publicarPlano(T.ctx, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.publicarHorario }));
    const c = corpo(1);
    await salvarRascunho(T.ctx, id, { ...c, refeicoes: [...c.refeicoes, { id: randomUUID(), nome: 'Ceia', horario: '21:00', observacao: '', itens: [] }] }, deps);
    await expect(publicarPlano(T.ctx, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.publicarRefeicaoVazia('Ceia') }));
    expect((await carregarPlano(T.ctx, id, app.db))?.status).toBe('rascunho');
  });

  it('Review Focus 4 (D10): corrigir "Meu alimento" depois não muda o plano publicado; o rascunho novo usa o valor novo; excluir é recusado', async () => {
    const T = await novoTenant(app.db);
    const { id: foodId } = await criarAlimento(T.ctx, { nome: 'Pão low carb Marca X', grupo: 'Cereais e derivados', kcal: '250', proteinaG: '12', carboidratoG: '8', lipidioG: '18', fibraG: '6' }, deps);
    const { id: v1 } = await publicado(T, [item(foodId)]);
    await editarAlimento(T.ctx, foodId, { nome: 'Pão low carb (nova receita)', grupo: 'Cereais e derivados', kcal: '300', proteinaG: '12', carboidratoG: '8', lipidioG: '18', fibraG: '6' }, deps);
    expect((await carregarPlano(T.ctx, v1, app.db))!.refeicoes[0].itens[0]).toMatchObject({ nome: 'Pão low carb Marca X', porCem: { kcal: 250 } });
    const { id: v2 } = await editarPublicado(T.ctx, v1, deps);
    expect((await carregarPlano(T.ctx, v2, app.db))!.refeicoes[0].itens[0]).toMatchObject({ nome: 'Pão low carb (nova receita)', porCem: { kcal: 300 } });
    await expect(excluirAlimento(T.ctx, foodId, deps)).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.emUso } });
  });

  it('Review Focus 5 (D12, US-025 "Rascunho invisível"): a sessão do paciente lê só os próprios planos publicados/arquivados', async () => {
    const T = await novoTenant(app.db);
    const { p, id: v1 } = await publicado(T);
    const { id: v2 } = await editarPublicado(T.ctx, v1, deps); // rascunho v2
    await criarModelo(T.ctx, 'Modelo', deps);
    const outra = await publicado(T);
    const ler = (q: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(q), app.db).then((r) => r.rows);
    expect((await ler(sql`select id, status from meal_plans`)).map((r) => r.id)).toEqual([v1]);
    expect(await ler(sql`select 1 from meals where plan_id = ${v2}`)).toEqual([]);
    expect(await ler(sql`select 1 from meal_items where plan_id = ${v2}`)).toEqual([]);
    expect(await ler(sql`select 1 from meals where plan_id = ${outra.id}`)).toEqual([]);
    expect((await ler(sql`select 1 from meal_items where plan_id = ${v1}`)).length).toBe(1);
  });

  it('publicado não é salvo nem publicado de novo; modelo não é publicado; paciente bloqueado não publica', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await publicado(T);
    await expect(salvarRascunho(T.ctx, id, corpo(99), deps)).rejects.toBeInstanceOf(PlanoNaoEditavelError);
    await expect(publicarPlano(T.ctx, id, deps)).rejects.toBeInstanceOf(PlanoNaoEditavelError);
    const { id: modelo } = await criarModelo(T.ctx, 'Modelo', deps);
    await expect(publicarPlano(T.ctx, modelo, deps)).rejects.toBeInstanceOf(PlanoNaoEditavelError);
    const { id: v2 } = await editarPublicado(T.ctx, id, deps);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(publicarPlano(T.ctx, v2, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/publicacao.test.ts` → FAIL (`Cannot find module './publicacao'`).

- [ ] **Step 3: Implementar** — `src/modules/plano-alimentar/publicacao.ts`

```ts
import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { lerPlanoNaTransacao } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import { copiarConteudo, proximaVersao } from './rascunho';
import type { PlanoCompleto } from './tipos';

type Deps = { db?: Db; now?: Date; boss?: PgBoss };

function exigirPublicavel(p: PlanoCompleto) {
  if (!p.refeicoes.length || !p.refeicoes.some((r) => r.itens.length)) throw new PlanoError({ geral: MSG_PLANO.publicarVazio });
  if (p.refeicoes.some((r) => !r.horario)) throw new PlanoError({ geral: MSG_PLANO.publicarHorario });
  const vazia = p.refeicoes.find((r) => !r.itens.some((i) => !i.substituiItemId));
  if (vazia) throw new PlanoError({ geral: MSG_PLANO.publicarRefeicaoVazia(vazia.nome) });
}

/**
 * US-025 / RN-01, numa transação: arquiva o publicado anterior, congela os nutrientes dos itens (D10),
 * publica e enfileira o PDF (US-026). Travas na mesma ordem do salvamento: paciente → plano.
 * Plano 06: o aviso ao paciente (push + e-mail, adiado — ver desvios) entra aqui, enfileirado nesta transação.
 */
export async function publicarPlano(ctx: TenantContext, planId: string, deps: Deps = {}): Promise<{ versao: number }> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  const now = deps.now ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    ctx,
    async (tx) => {
      const [antes] = await tx.select({ patientId: mealPlans.patientId }).from(mealPlans).where(eq(mealPlans.id, planId));
      if (!antes) throw new PlanoNaoEncontradoError();
      if (!antes.patientId) throw new PlanoNaoEditavelError(); // modelo não se publica
      await carregarPacienteParaEscrita(tx, antes.patientId);
      const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId)).for('update');
      if (p.status !== 'rascunho') throw new PlanoNaoEditavelError();
      const completo = (await lerPlanoNaTransacao(tx, planId, { auditar: false }))!;
      exigirPublicavel(completo);

      await tx
        .update(mealPlans)
        .set({ status: 'arquivado', updatedAt: now })
        .where(and(eq(mealPlans.patientId, antes.patientId), eq(mealPlans.status, 'publicado')));
      // D10: cópia dos valores por 100 g e do nome de cada alimento no momento da publicação
      await tx.execute(sql`
        update meal_items mi set nutrientes = jsonb_build_object(
          'nome', f.nome,
          'origem', case when f.tenant_id is null then 'TACO' else 'Meu alimento' end,
          'kcal', f.kcal, 'proteinaG', f.proteina_g, 'carboidratoG', f.carboidrato_g, 'lipidioG', f.lipidio_g, 'fibraG', f.fibra_g),
          updated_at = ${now}
        from foods f
        where f.id = mi.food_id and mi.plan_id = ${planId}`);
      await tx
        .update(mealPlans)
        .set({ status: 'publicado', publicadoEm: now, pdfStatus: 'pendente', pdfPath: null, updatedAt: now })
        .where(eq(mealPlans.id, planId));
      const job = await boss.send('plano-pdf', { tenantId: ctx.tenantId, planId }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou o PDF do plano');
      return { versao: p.versao };
    },
    deps.db ?? getDb(),
  );
}

/** US-025 "Editar": rascunho versão + 1 copiado do publicado (ou o rascunho que já existe, D11). */
export async function editarPublicado(ctx: TenantContext, planId: string, deps: Deps = {}): Promise<{ id: string; criado: boolean }> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId));
      if (!p || !p.patientId) throw new PlanoNaoEncontradoError();
      await carregarPacienteParaEscrita(tx, p.patientId);
      const [rasc] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, p.patientId), eq(mealPlans.status, 'rascunho')));
      if (rasc) return { id: rasc.id, criado: false };
      const [novo] = await tx
        .insert(mealPlans)
        .values({
          tenantId: ctx.tenantId,
          patientId: p.patientId,
          titulo: p.titulo,
          metaKcal: p.metaKcal,
          energyCalcId: p.energyCalcId,
          mostrarCalorias: p.mostrarCalorias,
          orientacoes: p.orientacoes,
          origemPlanId: p.id,
          versao: await proximaVersao(tx, p.patientId),
        })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, p.id, { id: novo.id, patientId: p.patientId, tenantId: ctx.tenantId });
      return { id: novo.id, criado: true };
    },
    deps.db ?? getDb(),
  );
}
```

Run: `pnpm test src/modules/plano-alimentar/publicacao.test.ts` → PASS (7 testes).

- [ ] **Step 4: Telas**

Em `src/app/painel/pacientes/[id]/plano-alimentar/actions.ts`, acrescentar (imports: `publicarPlano`, `editarPublicado`, `PlanoError`, `PlanoNaoEditavelError`):

```ts
export async function publicarAction(patientId: string, planId: string, _prev: AcaoPlanoState): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  try {
    await publicarPlano(ctx, planId);
  } catch (e) {
    if (e instanceof PlanoError) return { erro: Object.values(e.erros)[0] };
    if (e instanceof PlanoNaoEditavelError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PlanoNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar`, 'layout');
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${planId}?publicado=1`);
}

export async function editarPublicadoAction(patientId: string, planId: string, _prev: AcaoPlanoState): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  let id: string;
  try {
    ({ id } = await editarPublicado(ctx, planId));
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PlanoNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}
```

Na tela do plano (`[planId]/page.tsx`): ler `searchParams` (`const { publicado } = await searchParams;`), mostrar `{publicado === '1' && <p role="status" className="rounded bg-emerald-50 p-3">Plano publicado.</p>}` acima do editor e montar `acoes` assim:

```tsx
        acoes={
          <div className="flex flex-wrap items-start gap-4">
            {rascunho && (
              <BotaoAcao acao={publicarAction.bind(null, paciente.id, plano.id)} rotulo="Publicar" confirmar="Publicar esta versão para o paciente? A versão publicada hoje será arquivada." />
            )}
            {plano.status === 'publicado' && <BotaoAcao acao={editarPublicadoAction.bind(null, paciente.id, plano.id)} rotulo="Editar" principal={false} />}
            <SalvarComoModelo acao={salvarComoModeloAction.bind(null, plano.id)} tituloSugerido={plano.titulo} />
            {rascunho && (
              <form action={descartarRascunhoAction.bind(null, paciente.id, plano.id)}>
                <ConfirmarBotao mensagem="Descartar este rascunho?">Descartar rascunho</ConfirmarBotao>
              </form>
            )}
          </div>
        }
```

Na tela de versões (`plano-alimentar/page.tsx`), quando há publicado e não há rascunho, mostrar `<BotaoAcao acao={editarPublicadoAction.bind(null, paciente.id, publicado.id)} rotulo="Editar o plano publicado" />` (com `const publicado = planos.find((p) => p.status === 'publicado');`).

- [ ] **Step 5: E2E** — acrescentar a `e2e/plano-alimentar.spec.ts`:

```ts
test('publicar v1, editar cria v2 com a v1 ainda publicada, publicar v2 arquiva a v1 (US-025, RN-01)', async () => {
  await nutri.goto(editor);
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
  await expect(nutri.getByText('Versão 1 · Publicado')).toBeVisible();
  await expect(nutri.getByLabel(`Gramas de ${ALIMENTO_130}`)).toBeDisabled();

  await nutri.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(nutri.getByRole('heading', { name: 'Plano alimentar — versão 2' })).toBeVisible();
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await expect(nutri.getByRole('row', { name: /Versão 1/ })).toContainText('Publicado');
  await expect(nutri.getByRole('row', { name: /Versão 2/ })).toContainText('Rascunho');

  await nutri.getByRole('link', { name: 'Continuar o rascunho (versão 2)' }).click();
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await expect(nutri.getByRole('row', { name: /Versão 1/ })).toContainText('Arquivado');
  await expect(nutri.getByRole('row', { name: /Versão 2/ })).toContainText('Publicado');
  editor = (await nutri.getByRole('link', { name: 'Versão 2' }).getAttribute('href'))!; // a v2 publicada (a Tarefa 11 usa)
});
```

Run: `pnpm build && pnpm test:e2e e2e/plano-alimentar.spec.ts` → PASS.

- [ ] **Step 6: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/jobs/queues.ts src/modules/plano-alimentar src/app/painel/pacientes e2e/plano-alimentar.spec.ts
git commit -m "feat(plano-alimentar): publicação com 1 plano publicado por paciente, nutrientes congelados e nova versão em rascunho (P04-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: PDF do plano gerado pelo worker, download no painel, PDFs na anonimização e limpeza de `.tmp` órfãos (P04-09)

**Files:**
- Create: `src/modules/plano-alimentar/plano-pdf.tsx`, `src/modules/plano-alimentar/plano-pdf-job.ts`, `src/modules/plano-alimentar/plano-pdf-job.test.ts`, `test/pdf.ts`, `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/pdf-do-plano.tsx`, `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/atualizar-enquanto.tsx`
- Modify: `src/modules/plano-alimentar/publicacao.ts` (`pedirNovoPdf`), `src/jobs/queues.ts` (fila `limpar-tmp`), `src/worker/index.ts`, `src/modules/plataforma/armazenamento.ts` (`limparTmpOrfaos`), `src/modules/plataforma/armazenamento.test.ts`, `src/modules/pacientes/lgpd.ts` (`anexosDoPaciente`), `src/modules/pacientes/exportacao.test.ts` (helper movido e regex da guarda), `src/app/painel/pacientes/[id]/plano-alimentar/actions.ts`, `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx`, `e2e/plano-alimentar.spec.ts`

**Interfaces:**
- Consumes: `lerPlanoNaTransacao`, `type PlanoCompleto` (Tarefa 6); `totalDosItens`, `totalDoDia`, `nutrientesDoItem`, `distribuicaoMacros`, `kcalTexto`, `gTexto`, `diferencaKcal` (Tarefa 5); `FONTE_TACO_TEXTO` (Tarefa 1); fila `plano-pdf` e `publicarPlano` (Tarefa 10); `salvarArquivo`, `resolverCaminho`, `CotaEsgotadaError` (`@/modules/plataforma/armazenamento`); `buscarTenant`, `tenantIsActive` (`@/modules/plataforma/tenant-status`); `paraWinAnsi` (`@/modules/pacientes/prontuario-pdf`); `COR_PADRAO`; `signFileUrl`; `hojeNoFuso`, `formatarData`; `logger`.
- Produces:
  - `@/modules/plano-alimentar/plano-pdf` (só worker): `type DadosPdfPlano`, `renderizarPlano(d: DadosPdfPlano): Promise<Buffer>`.
  - `@/modules/plano-alimentar/plano-pdf-job` (só worker): `gerarPdfDoPlano(data: { tenantId; planId }, deps: { db; dataDir; now?; ultimaTentativa; renderizar? }): Promise<'pronto' | 'ignorado' | 'falhou'>`.
  - `@/modules/plano-alimentar/publicacao`: `pedirNovoPdf(ctx, planId, deps?): Promise<void>` (só de `pdf_status = 'falhou'`).
  - `@/modules/plataforma/armazenamento`: `limparTmpOrfaos(dataDir: string, agora: Date, idadeMinMs?: number): Promise<number>`.
  - `test/pdf.ts`: `textoDoPdf(pdf: Buffer): string`.

- [ ] **Step 1: Helper de texto de PDF** — mover a função `textoDoPdf` de `src/modules/pacientes/exportacao.test.ts` para `test/pdf.ts` (com `export` e o import de `inflateSync` de `node:zlib`) e importá-la de volta no teste de exportação: `import { textoDoPdf } from '../../../test/pdf';`. Na guarda do mesmo arquivo, trocar o regex por `/exportacao-job|@react-pdf|prontuario-pdf|plano-pdf/` e o título por `'o PDF e o ZIP ficam fora do grafo do Next: nenhuma rota importa exportacao-job, plano-pdf ou @react-pdf'`.

Run: `pnpm test src/modules/pacientes/exportacao.test.ts` → PASS.

- [ ] **Step 2: Testes do PDF (falham)** — `src/modules/plano-alimentar/plano-pdf-job.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { textoDoPdf } from '../../../test/pdf';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { anexosDoPaciente } from '@/modules/pacientes/lgpd';
import { COTA_BYTES, resolverCaminho } from '@/modules/plataforma/armazenamento';
import { carregarPlano } from './carregar';
import { renderizarPlano } from './plano-pdf';
import { gerarPdfDoPlano } from './plano-pdf-job';
import { pedirNovoPdf, publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { RascunhoEnviado } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const dataDir = process.env.DATA_DIR!;
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
const job = (T: TenantDeTeste, planId: string, extra: Partial<Parameters<typeof gerarPdfDoPlano>[1]> = {}) =>
  gerarPdfDoPlano({ tenantId: T.tenantId, planId }, { db: app.db, dataDir, now, ultimaTentativa: false, ...extra });

function conteudo(mostrarCalorias: boolean): RascunhoEnviado {
  const pao = randomUUID();
  return {
    revisao: 0, titulo: 'Plano de Ana', metaKcal: '2000', mostrarCalorias, orientacoes: 'Beber 2 litros de água por dia.',
    refeicoes: [
      { id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: 'Prato colorido', itens: [
        { id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 }, substituiItemId: null },
      ] },
      { id: randomUUID(), nome: 'Café da manhã', horario: '07:30', observacao: '', itens: [
        { id: pao, foodId: idTaco(53), quantidadeG: '50', medida: null, substituiItemId: null },
        { id: randomUUID(), foodId: idTaco(551), quantidadeG: '40', medida: null, substituiItemId: pao },
      ] },
    ],
  };
}

async function planoPublicado(T: TenantDeTeste, mostrarCalorias = false) {
  await app.db.update(tenants).set({ crn: 'CRN-3 12345' }).where(eq(tenants.id, T.tenantId));
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  await salvarRascunho(T.ctx, id, conteudo(mostrarCalorias), deps);
  await publicarPlano(T.ctx, id, deps);
  return { p, id };
}

describe('PDF do plano (US-026)', () => {
  it('"Geração na publicação": o worker grava o PDF e o pdf_path; rodar de novo não gera outro', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await planoPublicado(T);
    expect(await job(T, id)).toBe('pronto');
    const pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl).toMatchObject({ pdfStatus: 'pronto' });
    expect(pl!.pdfPath).toMatch(new RegExp(`^${T.tenantId}/plano_pdf/[0-9a-f-]{36}\\.pdf$`));
    expect(existsSync(resolverCaminho(dataDir, pl!.pdfPath!))).toBe(true);
    expect(await job(T, id)).toBe('ignorado');
    const anexos = await withTenant(T.ctx, (tx) => anexosDoPaciente(tx, p.id), app.db);
    expect(anexos).toContain(pl!.pdfPath); // anonimização (US-018) apaga o PDF do plano
  });

  it('"Conteúdo do PDF": nutricionista, CRN, paciente, data, refeições por horário, medida e gramas, substituição, orientações e fonte; sem calorias por padrão', async () => {
    const T = await novoTenant(app.db);
    const { id } = await planoPublicado(T);
    let pdf: Buffer | null = null;
    await job(T, id, { renderizar: async (d) => (pdf = await renderizarPlano(d)) });
    const texto = textoDoPdf(pdf!);
    for (const t of [
      'Debby Silva', 'CRN-3 12345', 'Paciente: Ana Souza', 'Data: 01/10/2026', 'Plano de Ana',
      'Café da manhã · 07:30', 'Almoço · 12:00', 'Pão, trigo, francês', '50 g',
      'Arroz, tipo 1, cozido', '4 colheres de sopa cheias (100 g)', 'ou Tapioca, com manteiga', 'Prato colorido',
      'Beber 2 litros de água por dia.', 'TACO 4', 'NEPA/UNICAMP',
    ]) expect(texto, t).toContain(t);
    expect(texto.indexOf('Café da manhã')).toBeLessThan(texto.indexOf('Almoço')); // por horário
    expect(texto).not.toContain('kcal');
  });

  it('"Mostrar calorias ao paciente" marcado: totais por refeição e do dia', async () => {
    const T = await novoTenant(app.db);
    const { id } = await planoPublicado(T, true);
    let pdf: Buffer | null = null;
    await job(T, id, { renderizar: async (d) => (pdf = await renderizarPlano(d)) });
    const texto = textoDoPdf(pdf!);
    expect(texto).toContain('Total do dia: 278 kcal'); // arroz 128 + pão 150 (substituição fora)
    expect(texto).toContain('139 kcal');
  });

  it('6 refeições e 40 itens: PDF em até 5 s de processamento', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    const refeicoes = Array.from({ length: 6 }, (_, r) => ({
      id: randomUUID(), nome: `Refeição ${r + 1}`, horario: `${String(7 + 2 * r).padStart(2, '0')}:00`, observacao: 'Observação da refeição',
      itens: Array.from({ length: r < 4 ? 7 : 6 }, (_, i) => ({ id: randomUUID(), foodId: idTaco(1 + ((r * 7 + i) % 597)), quantidadeG: '100', medida: null, substituiItemId: null })),
    }));
    await salvarRascunho(T.ctx, id, { revisao: 0, titulo: 'Grande', metaKcal: '', mostrarCalorias: true, orientacoes: '', refeicoes }, deps);
    await publicarPlano(T.ctx, id, deps);
    const t0 = performance.now();
    expect(await job(T, id)).toBe('pronto');
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('falhas: tenant suspenso e cota esgotada marcam "falhou"; erro na última tentativa marca "falhou"; antes disso a fila tenta de novo', async () => {
    const T1 = await novoTenant(app.db);
    const a = await planoPublicado(T1);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T1.tenantId));
    expect(await job(T1, a.id)).toBe('ignorado');
    expect((await owner.pool.query(`select pdf_status from meal_plans where id = $1`, [a.id])).rows[0].pdf_status).toBe('falhou');

    const T2 = await novoTenant(app.db);
    const b = await planoPublicado(T2);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T2.tenantId));
    expect(await job(T2, b.id)).toBe('falhou');

    const T3 = await novoTenant(app.db);
    const c = await planoPublicado(T3);
    const quebra = async () => {
      throw new Error('falha no render');
    };
    await expect(job(T3, c.id, { renderizar: quebra })).rejects.toThrow('falha no render');
    expect((await carregarPlano(T3.ctx, c.id, app.db))?.pdfStatus).toBe('pendente');
    expect(await job(T3, c.id, { renderizar: quebra, ultimaTentativa: true })).toBe('falhou');
    // "Gerar o PDF de novo": volta a pendente e enfileira
    await pedirNovoPdf(T3.ctx, c.id, deps);
    expect((await carregarPlano(T3.ctx, c.id, app.db))?.pdfStatus).toBe('pendente');
    const n = await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [c.id]);
    expect(n.rows[0].n).toBe(2); // o da publicação + o do pedido novo
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/plano-pdf-job.test.ts`
Expected: FAIL — `Cannot find module './plano-pdf-job'`.

- [ ] **Step 3: Documento** — `src/modules/plano-alimentar/plano-pdf.tsx`

```tsx
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { FONTE_TACO_TEXTO } from '@/modules/alimentos/taco';
import { paraWinAnsi } from '@/modules/pacientes/prontuario-pdf';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { diferencaKcal, kcalTexto, nutrientesDoItem, totalDoDia, totalDosItens } from './calculo';
import type { PlanoCompleto, RefeicaoPlano } from './tipos';

/** Só o worker importa este arquivo (US-026; fora do grafo do Next — guarda em exportacao.test.ts). */
export type DadosPdfPlano = {
  plano: PlanoCompleto;
  nutricionista: { nome: string; crn: string | null };
  paciente: string;
  /** dd/mm/aaaa no fuso do tenant. */
  data: string;
  cor: string;
  logo: Buffer | null;
};

const s = StyleSheet.create({
  pagina: { padding: 36, paddingBottom: 48, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  refeicao: { marginTop: 10, fontSize: 12, fontFamily: 'Helvetica-Bold' },
  item: { marginLeft: 8 },
  sub: { marginLeft: 22, color: '#444444' },
  obs: { marginLeft: 8, color: '#444444', fontStyle: 'italic' },
  rodape: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 8, color: '#666666', flexDirection: 'row', justifyContent: 'space-between' },
});

const gramas = (g: number) => `${formatarDecimal(g, casasDecimais(g))} g`;
const quantidade = (i: RefeicaoPlano['itens'][number]) => (i.medidaCaseiraTxt ? `${i.medidaCaseiraTxt} (${gramas(i.quantidadeG)})` : gramas(i.quantidadeG));
const porHorario = (rs: RefeicaoPlano[]) => [...rs].sort((a, b) => a.horario.localeCompare(b.horario));
const calculo = (r: RefeicaoPlano) => r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId }));

function Plano({ d }: { d: DadosPdfPlano }) {
  const { plano } = d;
  const total = totalDoDia(plano.refeicoes.map((r) => ({ itens: calculo(r) })));
  return (
    <Document title={plano.titulo} author={d.nutricionista.nome} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <View style={[s.topo, { borderBottomColor: d.cor }]}>
          <View>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>{d.nutricionista.nome}</Text>
            {d.nutricionista.crn && <Text>{d.nutricionista.crn}</Text>}
          </View>
          {d.logo && <Image style={s.logo} src={{ data: d.logo, format: 'png' }} />}
        </View>
        <Text style={s.titulo}>{plano.titulo}</Text>
        <Text>Paciente: {d.paciente}</Text>
        <Text>Data: {d.data}</Text>
        {plano.mostrarCalorias && <Text>Total do dia: {kcalTexto(total.kcal)} kcal</Text>}
        {porHorario(plano.refeicoes).map((r) => (
          <View key={r.id} wrap={false}>
            <Text style={s.refeicao} minPresenceAhead={28}>
              {r.nome} · {r.horario}
              {plano.mostrarCalorias ? `  (${kcalTexto(totalDosItens(calculo(r)).kcal)} kcal)` : ''}
            </Text>
            {r.itens.map((i) => {
              const n = nutrientesDoItem(i.porCem, i.quantidadeG);
              const principal = r.itens.find((x) => x.id === i.substituiItemId);
              const kcal = plano.mostrarCalorias ? (n.semValor.includes('kcal') ? ' · —' : ` · ${kcalTexto(n.kcal)} kcal`) : '';
              if (!principal) return <Text key={i.id} style={s.item}>• {i.nome} — {quantidade(i)}{kcal}</Text>;
              const dif = plano.mostrarCalorias ? ` (${diferencaKcal(n.kcal, nutrientesDoItem(principal.porCem, principal.quantidadeG).kcal)})` : '';
              return <Text key={i.id} style={s.sub}>ou {i.nome} — {quantidade(i)}{kcal}{dif}</Text>;
            })}
            {r.observacao && <Text style={s.obs}>{r.observacao}</Text>}
          </View>
        ))}
        {plano.orientacoes && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.refeicao}>Orientações</Text>
            <Text>{plano.orientacoes}</Text>
          </View>
        )}
        <View style={s.rodape} fixed>
          <Text>Fonte: {FONTE_TACO_TEXTO}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Helvetica padrão (WinAnsi), como o prontuário: todo texto passa por paraWinAnsi (emoji e afins viram "?"). */
export async function renderizarPlano(d: DadosPdfPlano): Promise<Buffer> {
  const w = paraWinAnsi;
  const plano: PlanoCompleto = {
    ...d.plano,
    titulo: w(d.plano.titulo),
    orientacoes: w(d.plano.orientacoes),
    refeicoes: d.plano.refeicoes.map((r) => ({
      ...r,
      nome: w(r.nome),
      observacao: w(r.observacao),
      itens: r.itens.map((i) => ({ ...i, nome: w(i.nome), medidaCaseiraTxt: i.medidaCaseiraTxt && w(i.medidaCaseiraTxt) })),
    })),
  };
  return renderToBuffer(<Plano d={{ ...d, plano, paciente: w(d.paciente), nutricionista: { nome: w(d.nutricionista.nome), crn: d.nutricionista.crn && w(d.nutricionista.crn) } }} />);
}
```

- [ ] **Step 4: Job** — `src/modules/plano-alimentar/plano-pdf-job.ts`

```ts
import { readFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mealPlans, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
import { buscarTenant, tenantIsActive } from '@/modules/plataforma/tenant-status';
import { lerPlanoNaTransacao } from './carregar';
import { renderizarPlano } from './plano-pdf';

/** Só o worker importa este arquivo (@react-pdf/renderer fica fora do grafo do Next). */
export type DadosJobPdf = { tenantId: string; planId: string };
export type DepsJobPdf = { db: Db; dataDir: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarPlano };

class JaProntoError extends Error {}

/**
 * US-026 "Geração na publicação": lê o plano publicado (valores congelados, D10), gera o PDF com a marca
 * (D14) e grava pdf_path + pdf_status = 'pronto' no `registrar` de salvarArquivo (CLAUDE.md regra 9).
 * Idempotente: só age com pdf_status = 'pendente'. Cota esgotada ou última tentativa → 'falhou'.
 */
export async function gerarPdfDoPlano(data: DadosJobPdf, deps: DepsJobPdf): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const marcarFalhou = () =>
    withTenant(ctx, (tx) => tx.update(mealPlans).set({ pdfStatus: 'falhou', updatedAt: now }).where(and(eq(mealPlans.id, data.planId), eq(mealPlans.pdfStatus, 'pendente'))), db);
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorado';
  }
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx
        .select({ id: mealPlans.id, patientId: mealPlans.patientId })
        .from(mealPlans)
        .where(and(eq(mealPlans.id, data.planId), eq(mealPlans.pdfStatus, 'pendente'), inArray(mealPlans.status, ['publicado', 'arquivado'])));
      if (!p?.patientId) return null;
      const [pac] = await tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, p.patientId));
      // o worker não é usuário: a leitura não vira "ler" no histórico de acessos; a publicação já foi auditada
      const plano = await lerPlanoNaTransacao(tx, p.id, { auditar: false });
      return plano && pac ? { plano, paciente: pac.nome } : null;
    },
    db,
  );
  if (!lido) return 'ignorado';
  try {
    const tenant = (await buscarTenant(db, data.tenantId))!;
    const logo = tenant.logoPath ? await readFile(resolverCaminho(deps.dataDir, tenant.logoPath)).catch(() => null) : null;
    const pdf = await (deps.renderizar ?? renderizarPlano)({
      plano: lido.plano,
      nutricionista: { nome: tenant.nomeExibicao, crn: tenant.crn },
      paciente: lido.paciente,
      data: formatarData(hojeNoFuso(tenant.fuso, lido.plano.publicadoEm ? new Date(lido.plano.publicadoEm) : now)),
      cor: tenant.corPrimaria ?? COR_PADRAO,
      logo,
    });
    await salvarArquivo(
      ctx,
      {
        tipo: 'plano_pdf',
        conteudo: pdf,
        permitidos: ['pdf'],
        registrar: async (tx, arq) => {
          const r = await tx
            .update(mealPlans)
            .set({ pdfPath: arq.caminho, pdfStatus: 'pronto', updatedAt: now })
            .where(and(eq(mealPlans.id, data.planId), eq(mealPlans.pdfStatus, 'pendente')))
            .returning({ id: mealPlans.id });
          if (!r.length) throw new JaProntoError();
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return 'pronto';
  } catch (e) {
    if (e instanceof JaProntoError) return 'ignorado';
    if (e instanceof CotaEsgotadaError || deps.ultimaTentativa) {
      logger.warn({ planId: data.planId, tenantId: data.tenantId, motivo: e instanceof CotaEsgotadaError ? 'cota' : 'erro' }, 'PDF do plano não gerado');
      await marcarFalhou();
      return 'falhou';
    }
    throw e; // pg-boss tenta de novo
  }
}
```

Em `src/modules/plano-alimentar/publicacao.ts`, acrescentar (o painel chama; fica fora do `plano-pdf-job` para não puxar o react-pdf):

```ts
/** "Gerar o PDF de novo": só de 'falhou'; volta a 'pendente' e enfileira na mesma transação. */
export async function pedirNovoPdf(ctx: TenantContext, planId: string, deps: Deps = {}): Promise<void> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  const boss = deps.boss ?? (await getBoss());
  await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .update(mealPlans)
        .set({ pdfStatus: 'pendente', updatedAt: deps.now ?? new Date() })
        .where(and(eq(mealPlans.id, planId), eq(mealPlans.pdfStatus, 'falhou')))
        .returning({ id: mealPlans.id });
      if (!r.length) throw new PlanoNaoEncontradoError();
      await boss.send('plano-pdf', { tenantId: ctx.tenantId, planId }, { db: fromDrizzle(tx, sql) });
    },
    deps.db ?? getDb(),
  );
}
```

Em `src/modules/pacientes/lgpd.ts`, `anexosDoPaciente` passa a incluir os PDFs dos planos (import `mealPlans`):

```ts
  const dePlanos = await tx
    .select({ c: mealPlans.pdfPath })
    .from(mealPlans)
    .where(and(eq(mealPlans.patientId, patientId), isNotNull(mealPlans.pdfPath)));
  return [...deExames, ...deExportacoes, ...dePlanos].map((e) => e.c!);
```

(e o comentário da função: `/** Arquivos em /data ligados ao paciente: laudos, exportações e PDFs de plano. */`).

Run: `pnpm test src/modules/plano-alimentar/plano-pdf-job.test.ts src/modules/pacientes/lgpd.test.ts`
Expected: PASS (5 testes no PDF; o de LGPD continua verde com o PDF do plano entre os anexos).

- [ ] **Step 5: `.tmp` órfãos (item adiado do Plano 03)** — em `src/modules/plataforma/armazenamento.test.ts`, acrescentar:

```ts
  it('limparTmpOrfaos apaga só .tmp de salvarArquivo com mais de 24 h (queda no meio da gravação)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tmp-orfaos-'));
    const pasta = path.join(dir, '00000000-0000-4000-8000-000000000001', 'exame');
    await mkdir(pasta, { recursive: true });
    const velho = path.join(pasta, 'a.pdf.123.tmp');
    const novo = path.join(pasta, 'b.pdf.456.tmp');
    const normal = path.join(pasta, 'c.pdf');
    for (const f of [velho, novo, normal]) await writeFile(f, 'x');
    const agora = new Date('2026-10-02T12:00:00Z');
    await utimes(velho, new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'));
    await utimes(novo, new Date('2026-10-02T11:00:00Z'), new Date('2026-10-02T11:00:00Z'));
    await utimes(normal, new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T10:00:00Z'));
    expect(await limparTmpOrfaos(dir, agora)).toBe(1);
    expect(existsSync(velho)).toBe(false);
    expect(existsSync(novo)).toBe(true);
    expect(existsSync(normal)).toBe(true);
  });
```

(imports: `mkdtemp`, `mkdir`, `writeFile`, `utimes` de `node:fs/promises`; `existsSync`; `tmpdir`; `path`; `limparTmpOrfaos`.)

Em `src/modules/plataforma/armazenamento.ts`:

```ts
/** Plano 03 (c): `salvarArquivo` grava `<destino>.<pid>.tmp` antes da transação; uma queda deixa o .tmp. */
export async function limparTmpOrfaos(dataDir: string, agora: Date, idadeMinMs = 24 * 3600_000): Promise<number> {
  let apagados = 0;
  for (const tenant of await readdir(dataDir, { withFileTypes: true }).catch(() => [])) {
    if (!tenant.isDirectory()) continue;
    for (const tipo of await readdir(path.join(dataDir, tenant.name), { withFileTypes: true })) {
      if (!tipo.isDirectory()) continue;
      const pasta = path.join(dataDir, tenant.name, tipo.name);
      for (const f of await readdir(pasta)) {
        if (!/\.\d+\.tmp$/.test(f)) continue;
        const caminho = path.join(pasta, f);
        const { mtimeMs } = await stat(caminho);
        if (agora.getTime() - mtimeMs < idadeMinMs) continue;
        await rm(caminho, { force: true });
        apagados++;
      }
    }
  }
  return apagados;
}
```

(imports `readdir`, `stat`, `rm` de `node:fs/promises` se ainda não estiverem no arquivo.)

Run: `pnpm test src/modules/plataforma/armazenamento.test.ts` → PASS.

- [ ] **Step 6: Worker** — em `src/jobs/queues.ts`, no `QUEUES`: `'limpar-tmp': { retryLimit: 1, retryDelay: 600, expireInSeconds: 300 },`. Em `src/worker/index.ts` (imports: `gerarPdfDoPlano` de `@/modules/plano-alimentar/plano-pdf-job`, `limparTmpOrfaos`), junto dos outros `boss.work`:

```ts
  await boss.work('plano-pdf', { includeMetadata: true }, async ([job]: JobWithMetadata<{ tenantId: string; planId: string }>[]) => {
    await gerarPdfDoPlano(job.data, { db: getDb(), dataDir: env.DATA_DIR, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
  await boss.schedule('limpar-tmp', '0 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('limpar-tmp', async () => {
    const n = await limparTmpOrfaos(env.DATA_DIR, new Date());
    if (n) logger.info({ apagados: n }, 'arquivos .tmp órfãos removidos');
  });
```

- [ ] **Step 7: PDF no painel** — `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/atualizar-enquanto.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Recarrega os dados da página a cada 3 s, por até 60 s ("o botão é liberado quando o arquivo fica pronto"). */
export function AtualizarEnquanto() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 20) clearInterval(t);
      router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
```

`src/app/painel/pacientes/[id]/plano-alimentar/[planId]/pdf-do-plano.tsx` (Server Component):

```tsx
import { signFileUrl } from '@/lib/signed-url';
import type { PlanoCompleto } from '@/modules/plano-alimentar/tipos';
import { BotaoAcao } from '../botao-acao';
import { pedirNovoPdfAction } from '../actions';
import { AtualizarEnquanto } from './atualizar-enquanto';

/** US-026: download imediato quando pronto; "Seu PDF está sendo preparado" enquanto o worker gera. */
export function PdfDoPlano({ plano, patientId }: { plano: PlanoCompleto; patientId: string }) {
  if (plano.pdfStatus === 'pronto' && plano.pdfPath)
    return <a href={signFileUrl(plano.pdfPath)} className="rounded border px-4 py-2">Baixar PDF</a>;
  if (plano.pdfStatus === 'falhou')
    return (
      <div className="space-y-1">
        <p role="alert" className="text-red-700">Não foi possível gerar o PDF. Tente de novo.</p>
        <BotaoAcao acao={pedirNovoPdfAction.bind(null, patientId, plano.id)} rotulo="Gerar o PDF de novo" principal={false} />
      </div>
    );
  if (plano.pdfStatus === 'pendente')
    return (
      <p role="status" className="text-zinc-700">
        Seu PDF está sendo preparado
        <AtualizarEnquanto />
      </p>
    );
  return null;
}
```

Em `actions.ts` (imports: `pedirNovoPdf`):

```ts
export async function pedirNovoPdfAction(patientId: string, planId: string, _prev: AcaoPlanoState): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  try {
    await pedirNovoPdf(ctx, planId);
  } catch (e) {
    if (e instanceof PlanoNaoEncontradoError) return { erro: 'O PDF já está sendo preparado.' };
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  return {};
}
```

Na tela do plano (`[planId]/page.tsx`), dentro de `acoes`, para `plano.status !== 'rascunho'`: `<PdfDoPlano plano={plano} patientId={paciente.id} />`.

- [ ] **Step 8: E2E** — acrescentar a `e2e/plano-alimentar.spec.ts` (o worker roda no `webServer` do Playwright):

```ts
test('PDF gerado pelo worker na publicação e baixado pelo painel (US-026)', async () => {
  await nutri.goto(editor); // v2 publicada na Tarefa 10
  await expect(nutri.getByRole('link', { name: 'Baixar PDF' })).toBeVisible({ timeout: 30_000 }); // ≤ 30 s
  const href = await nutri.getByRole('link', { name: 'Baixar PDF' }).getAttribute('href');
  const r = await nutri.request.get(href!);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('application/pdf');
  expect((await r.body()).subarray(0, 5).toString()).toBe('%PDF-');
});
```

Run: `pnpm build && pnpm test:e2e e2e/plano-alimentar.spec.ts` → PASS.

- [ ] **Step 9: Suíte e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

```bash
git add src/modules/plano-alimentar src/modules/plataforma/armazenamento.ts src/modules/plataforma/armazenamento.test.ts src/modules/pacientes/lgpd.ts \
  src/modules/pacientes/exportacao.test.ts src/jobs/queues.ts src/worker/index.ts src/app/painel/pacientes test/pdf.ts e2e/plano-alimentar.spec.ts
git commit -m "feat(plano-alimentar): PDF com a marca gerado pelo worker na publicação, download no painel e limpeza de .tmp órfãos (P04-09)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Fechamento do plano (após a Tarefa 11)

- [ ] Revisão da entrega conforme o índice: revisor por tarefa (feito ao longo) → `/code-review high` no PR → corrigir → `/code-review high` (precisa sair sem problema confirmado) → `/security-review` com o **checklist reforçado** deste plano:
  - **Isolamento:** `foods` com `tenant_isolation` + `taco_leitura` (TACO só leitura, nenhum tenant cria/altera/apaga linha nula); `food_measures`, `meal_plans`, `meals`, `meal_items` na matriz; política `paciente_sem_rascunho` (D12) nas 3 tabelas do plano; ids de refeição/item vindos do cliente nunca alcançam linha de outro plano/tenant (D8); `energyCalcId` só do mesmo paciente.
  - **Entrada:** corpo do `PUT` limitado (512 KB, 15 refeições, 200 itens, textos de 2000), JSON inválido = 422, quantidade/meta/horário validados no servidor, curingas do `LIKE` escapados na busca, CSV/SQL de seed gerados só por script (nada de texto de usuário em SQL).
  - **LGPD/RNF-08:** leituras de plano de paciente auditadas; escritas pelo gatilho; exportação inclui os planos; anonimização apaga os PDFs; paciente bloqueado não edita nem publica.
  - **Arquivos:** PDF só por `salvarArquivo` (cota, caminho do tenant, CHECK `pdf_path`), servido só por `signFileUrl`; `@react-pdf` fora do grafo do Next (guarda); `.tmp` órfãos limpos.
  - **Logs:** nada de nome de alimento, quantidade, nome de paciente ou conteúdo do plano (só ids e motivos).
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema confirmado depois da 3ª rodada, parar e avisar o dono.
- [ ] Atualizar o status de P04-01 a P04-09 no backlog (arquivo `2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT), e levar junto o commit `docs(backlog): sincroniza…` da branch `docs-sincroniza-backlog` (01/10/2026), que ainda não foi para a `main`.
- [ ] Atualizar a spec para a v1.6 (Apêndice C e corpo) com os "Desvios conscientes" desta página: aviso ao paciente na publicação adiado para o Plano 06; seed IBGE inicial de 28 alimentos (E-08 amplia por CSV); `substitui_item_id` no lugar de `grupo_substituicao`; `tenant_id`/`patient_id`/`plan_id` nas tabelas filhas; colunas `revisao`, `orientacoes`, `pdf_status`, `medida`, `nutrientes`, `ordem`; `recipe_content_id` no Plano 07; `energy_calc_id` sem FK; quantidade 0,1–5000 g; política RLS `taco_leitura` e `paciente_sem_rascunho`; os textos novos de interface.
- [ ] Anotar para os próximos planos:
  - **Plano 06 (portal):** aviso de plano novo (push + e-mail) entra em `publicarPlano`, enfileirado na mesma transação; o portal lê `meal_plans`/`meals`/`meal_items` direto com a sessão do paciente (D12 já garante "nunca rascunho"), em ordem de horário (US-041), com `mostrar_calorias` respeitado; o download do PDF pelo paciente precisa da restrição de `stored_files` por paciente (item adiado (a)); a cópia congelada (`nutrientes`) é a fonte dos valores.
  - **Plano 07 (conteúdo):** `meals.recipe_content_id` (US-054) e receitas com `recipe_ingredients.food_id` (FK `RESTRICT`, como `meal_items`) reaproveitando `buscarAlimentos`, `medidas` e o cálculo RN-02/RN-11.
  - **E-08 (Debby):** ampliar `seeds/medidas-ibge.csv` (cada linha com a referência exata do IBGE) e gerar uma migration nova com `pnpm seed:medidas` — o teste confere a fidelidade.
- [ ] Lembrar o dono: o **backup no host (P02-11, etapas 6 e 8)** segue pendente — sem ele, nada de pacientes reais; o merge (= deploy) só com OK explícito e snapshot no hPanel antes.
- [ ] Pedir ao dono o merge do PR (= deploy).

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec**

| Requisito | Onde |
|---|---|
| US-020 "Busca tolerante a acento" (≤ 300 ms, top 5) | Tarefa 3 (busca + teste de p95 com 3000 alimentos + E2E) |
| US-020 "Origem visível" (selo TACO / Meu alimento) | Tarefas 3 e 4 |
| US-020 "Medidas caseiras" (25 g × 4 = 100 g, "4 colheres de sopa cheias") | Tarefas 2 (seed IBGE + `textoMedida`) e 7 (editor + E2E) |
| US-020 "Alimento sem medida caseira" (só gramas + atalho que grava em `food_measures` do tenant) | Tarefas 2, 4 (tela da medida) e 7 (link no item) |
| US-021 "Cadastro" e "TACO não editável" | Tarefas 1 (RLS) e 4 |
| US-022 "Cálculo do item", "Indicador de meta", "Distribuição de macros" | Tarefas 5 (função pura) e 7 (painel + E2E) |
| US-022 "Salvamento automático" (≤ 2 s, "Alterações não salvas", repete ao voltar) | Tarefas 6 (PUT + revisão) e 7 (hook + E2E offline) |
| US-023 "Grupo de substituição" (fora do total, "+12 kcal") | Tarefas 5, 6 (validação) e 8 |
| US-024 "Criar a partir de modelo" / "Salvar plano como modelo" | Tarefa 9 |
| US-025 "Primeira publicação", "Nova versão arquiva a anterior", "Rascunho invisível" | Tarefa 10 (+ D12 na Tarefa 6); push adiado (desvio) |
| US-026 "Conteúdo do PDF", "Geração na publicação" (≤ 30 s; 6 × 40 em ≤ 5 s), "Download antes de ficar pronto" | Tarefa 11 |
| RN-01 (1 publicado, índice parcial, arquivar na mesma transação, imutável) | Tarefas 6 (índice) e 10 (+ D10) |
| RN-02 (fórmula, só principais, faixas, arredondamento) | Tarefa 5 |
| INT-04 (seed versionado, Tr → 0, NA → NULL, fonte citada) | Tarefas 1 e 2 (+ `*` → NULL e correção da planilha, D4) |
| P-10 (casamento TACO × IBGE) | Tarefa 2 (28 alimentos; o resto com E-08) |
| §7 `foods` (GIN `pg_trgm` + `unaccent`, RLS de leitura) | Tarefa 1 |
| RNF-07 (matriz de isolamento) e RNF-08 (auditoria) | Tarefas 1, 2 e 6 |
| RNF-01 (recálculo ≤ 100 ms no cliente) | Tarefa 5 (teste de tempo) |

**2. Placeholders:** nenhum "TBD"/"implementar depois"; todo passo de código tem o código. Os únicos trechos descritos em prosa são trocas mecânicas em arquivos existentes (imports, `abas.tsx`, cabeçalho, `normalizarTexto` nas 3 cópias), com o texto exato a usar.

**3. Consistência de tipos e nomes:** `AlimentoEncontrado`/`Nutrientes100` (T3) → `ItemPlano.porCem` (T6) → `ItemCalculo.porCem` (T5); `MedidaCaseira` (T1) e `MedidaDoItem` (T6) com `{ nome, plural, gramas }` (+ `qtd`); `RascunhoEnviado` (T6) com `energyCalcId` (usado em T7); `lerPlanoNaTransacao(tx, id, { auditar })` (T6) em exportação (T6), publicação (T10) e PDF (T11); `copiarConteudo`/`proximaVersao` (T6) em modelos (T9) e "Editar" (T10); fila `plano-pdf` declarada na T10 e consumida na T11; `BotaoAcao`/`AcaoPlanoState` (T7) reaproveitados em T9–T11.

**4. Review Focus:** 1 (duas abas) → testes "revisão velha" na T6 e `409` na API; 2 (quantidade) → T5 (`lerQuantidade`) e T6 (erro por campo, sem gravação parcial); 3 (sem valor na TACO) → T1 (seed), T5 (`semValor`), T11 (PDF mostra "—"); 4 (alimento próprio alterado/excluído) → T10 (D10 + `emUso`) e T4 (FK); 5 (sessão de paciente) → T10 (consulta direta como paciente) e matriz da T6.

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa, revisão do PR no fim) — as tarefas dependem umas das outras por interfaces bem definidas (T1 → T2 → T3 … → T11), e um erro de RLS, de auditoria ou de cálculo publicado é caro de desfazer em produção.
