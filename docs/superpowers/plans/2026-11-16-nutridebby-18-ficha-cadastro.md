# Plano 18 — Ficha e cadastro do paciente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cadastro completo do paciente (Res. CFN 594/2017) numa tabela filha protegida, lista com abas e ações, ficha com aba "Início" (cabeçalho com a última avaliação, botão Adicionar e seções com contador num registro que os outros planos reaproveitam) e a visão "No app do paciente", contada com as mesmas regras do portal.

**Architecture:** dois PRs (spec D21). **PR 1 — fundação, sem migration:** registro de seções em `src/modules/ficha/` (contrato `SecaoDaFicha`, 8 seções, uma transação `nutri`, sem `auditRead`), abas Início/Perfil, cabeçalho com a última antropometria (`cache()` por id, um `auditRead`) e a página Início com o diálogo Adicionar. **PR 2 — com migration:** `patient_cadastro` (RLS de tenant + paciente, política que nega o contexto `semConta`, auditoria como `patients`, gatilhos de colunas fixas e de apagar), regras do CPF com pré-checagem sob trava, formulário em seções, lista nova, "No app" no contexto de paciente `semConta` (`TxDePaciente`), LGPD (exportação, PDF, anonimização com rede) e a máscara da IA com o nome social.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, layouts, `cache` e Server Actions) · Drizzle · PostgreSQL 16 (RLS) · Better Auth · pg-boss · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-nutridebby-18-ficha-cadastro-design.md` (v0.2, revisada em 16/11/2026). **Antes da execução:** OK explícito do dono às trocas de recomendações aprovadas listadas no §15.2 da spec (D1 tabela filha e D16 contagem no contexto de paciente, principalmente).

## Global Constraints

- **Ordem de fundação.** PR 1 (Tarefas 1–4) entra na `main` antes de tudo o que outras sessões usam: o contrato `SecaoDaFicha`, `SECOES_DA_FICHA`, o tipo `TxDePaciente` e as abas Início/Perfil. Os Planos 17, 19 e 20 fazem rebase em cima dele (`sessoes-paralelas.md`, §7). PR 2 (Tarefas 5–12) só abre depois do merge do PR 1 e, por ter migration, entra na fila de migrations (uma por vez).
- **Migration sem número reservado** (spec D22): gerada em cima da `main` do momento (esperado depois de `0118`–`0120` do Plano 17) e **gerada de novo** se outra migration entrar antes do merge, pelo procedimento da seção "Migration" abaixo. Nenhum texto do plano, de teste ou do manual cita o número antes do PR 2 abrir.
- Regras 1, 2, 3, 7, 8 e 9 do `CLAUDE.md` (withTenant, RLS + guardas, nada sensível em log, `DATABASE_URL_MIGRATOR`, auditoria, `FABRICAS`). Nos arquivos disputados (`sessoes-paralelas.md` §6: `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `abas.tsx`, `docs/manual-tecnico/`, índice dos planos, backlog, `.claude/agent-memory/**`): **só acrescentar**, no fim da lista ou do bloco; nada de reordenar nem reformatar.
- **CPF** (spec D4, D23, RN-261, RN-262): só no campo do Perfil/Novo paciente e no `dados.json`. Nunca na lista, no cabeçalho, no Início, no "No app", no `prontuario.pdf`, em URL, em log (da aplicação **e do Postgres**), Sentry, mensagem, e-mail, push ou WhatsApp. Repetição conferida antes do INSERT, sob `pg_advisory_xact_lock(hashtext('patient_cadastro_cpf'), hashtext(tenant_id || ':' || cpf))`; o índice único é a última defesa. Toda regra dos CHECKs de `patient_cadastro` é conferida no servidor antes de gravar (o 23514 leva a linha inteira ao log do Postgres).
- **Leituras** (spec D14, D20, RN-268): a lista e o Início nunca leem CPF, endereço, telefone fixo, observação nem os outros campos novos, salvo `nome_social` (por projeção) e a **presença** dos campos da nota "Cadastro incompleto". Só a aba Perfil lê os valores (`cadastroDoPaciente`, com `auditRead` entidade `patients`). Seção do registro **nunca** chama `auditRead`. O cabeçalho grava **um** `auditRead` de `antropometria` por execução do layout.
- **`semConta`** (spec D1, D16, RN-281): só `src/modules/ficha/no-app.ts` entra em `SEM_CONTA_PERMITIDOS`; o helper que abre o contexto de paciente não é exportado; `noAppDoPaciente` só aceita `ctx.role === 'nutri'`; dentro, apenas contagens e ids, nenhuma coluna de conteúdo, nenhum `auditRead`, nunca `liberarReceitasDoPlano`. `patient_cadastro` é negada a todo contexto de paciente sem login (política `patient_cadastro_paciente_com_conta`).
- **IA** (spec D19, RN-282): de `patient_cadastro`, só `{ nomeSocial: patientCadastro.nomeSocial }`, só para `outrosNomes` da máscara; no contexto da IA Nutri, lido no contexto `worker`, fora da transação `semConta`.
- **Nome social** (spec D7, RN-266): tela da ficha com o nome social primeiro e "Nome de registro: …"; **impressão e `prontuario.pdf` com o nome civil primeiro** e "Nome social: …" logo depois (Res. CFN 594/2017, art. 4º, § 1º, I); lista só com o nome social; busca nos dois; ordem por `coalesce(nome_social, nome)`.
- Textos de interface em pt-BR, **exatos** da spec §5 e §8, em constantes (`MSG_CADASTRO`, `MSG_LISTA`, `MSG_FICHA`, `MSG_NO_APP`). "Parecer nutricional" (não "Parecer"), "Histórico" com `aria-label="Histórico de acessos"`.
- Acessibilidade (RNF-261): alvos `min-h-11`, `fieldset`/`legend`, erros com `aria-describedby` e `role="alert"`, região viva montada antes do texto, foco gerido no diálogo, no menu e depois de arquivar; axe a 1280 e 360 px, claro e escuro.
- Sem serviço externo nem custo novo (sem busca de CEP).

## Review Focus

1. **Contexto `semConta` nunca lê o cadastro** — convite, links, webhook, contexto da IA Nutri e o "No app" recebem 0 linhas de `patient_cadastro`; o titular com login lê só a própria. Teste em `src/db/patient-cadastro.test.ts` (Tarefa 5) e em `contexto.test.ts` da IA Nutri (Tarefa 11, nome social lido no `worker`).
2. **Paridade do "No app"** — receita sugerida fora da audiência (contada no contexto `nutri`, D24), conteúdo por etiqueta, plano arquivado, documento cancelado e anonimizado, envio cancelado, peso oculto e paciente arquivado: contagens e selos iguais ao que o portal devolve. Teste em `src/modules/ficha/no-app.test.ts` (Tarefa 9).
3. **CPF fora de todo log** — CPF repetido pelo caminho normal e pela corrida (duas conexões) não chega ao índice; entradas válidas pelo schema nunca violam CHECK; log capturado sem CPF, CEP e observação. Teste em `src/modules/pacientes/cadastro.test.ts` (Tarefa 6).
4. **Trilha de leitura** — Início sem `auditRead` das seções; cabeçalho com uma linha `ler` de `antropometria`; Perfil com a leitura de "Cadastro do paciente". Testes em `secoes.test.ts` (Tarefa 1), `cabecalho.test.ts` (Tarefa 3) e `cadastro.test.ts` (Tarefa 6).
5. **Ordem dos nomes no papel** — impressão da Anamnese de paciente com nome social sai com o nome civil primeiro; `prontuario.pdf` idem. Testes em `impressao.test.ts` (Tarefa 7) e `exportacao.test.ts` (Tarefa 10).
6. **Migration regenerada** — `drizzle/` do branch sai da `main` atual com os números seguintes, snapshot encadeado e as custom recriadas; nenhuma referência ao número antigo. Conferência da Tarefa 5 e de novo antes de abrir o PR 2.

---

## Ambiente da sessão

- **Sessão A, depois do Plano 17** (o Plano 17 ocupa a sessão A hoje). Porta **3101**, banco **`nutri_dev_a`**. O worktree é `../nutridebby-a` ou o atual `../nutridebby-18`:
  - **`../nutridebby-a`** (preferido, segue a convenção): depois do merge do Plano 17 e do fechamento da sessão dele (`sessoes-paralelas.md` §4, com OK do dono), `git worktree remove ../nutridebby-18` (árvore limpa, branch já no GitHub — com OK do dono, é apagar) e, do worktree principal, `scripts/sessao-paralela.sh a plano-18-ficha-cadastro`.
  - **`../nutridebby-18`** (se o dono preferir não mover): o script só cria `../nutridebby-<a|b|c>`, então os passos 5 a 7 do §4 são feitos à mão neste worktree — `.env.local` copiado do principal com `APP_URL=http://localhost:3101` e `nutri_dev_a` em `DATABASE_URL` e `DATABASE_URL_MIGRATOR` (conferir só os nomes, nunca imprimir o arquivo), `docker compose -f ../nutridebby/docker-compose.dev.yml exec db createdb -U nutri_owner nutri_dev_a` se faltar, `pnpm install --frozen-lockfile`, `pnpm db:migrate`.
  - O `scripts/sessao-paralela.sh` e o `docs/operacao/sessoes-paralelas.md` estão no branch `docs/sessoes-paralelas` (PR #50): usar depois do merge dele.
- Antes de qualquer comando: `env | cut -d= -f1 | grep -E '^(DATABASE_URL|APP_URL|DATA_DIR)'` vazio (variável exportada vence o `.env.local`).
- Dev: `pnpm exec next dev -p 3101`; worker: `pnpm worker`. E2E: parar o worker da sessão, `pnpm e2e:seed`, `pnpm build`, `APP_URL=http://localhost:3101 pnpm test:e2e <arquivos>` (a `APP_URL` só no comando). **Um E2E de cada vez entre as sessões** (Mailpit único). `pnpm test` sobe o próprio Postgres (Testcontainers); escalonar com as outras sessões.
- Nunca produção; banco da sessão só com dado fictício; MCP `postgres-dev` não aponta para o banco da sessão (usar `docker compose … exec db psql -U nutri_owner -d nutri_dev_a`).

## Migration (procedimento de `sessoes-paralelas.md` §5, sem número reservado)

O branch tem **duas** migrations, ambas da Tarefa 5: a **gerada** (`pnpm db:generate`, tabela `patient_cadastro`, CHECKs, índices) e a **custom** `rls_patient_cadastro` (`pnpm drizzle-kit generate --custom --name rls_patient_cadastro`), nessa ordem. Chamadas abaixo de `<G>` e `<R>`.

1. Gerar `<G>` e `<R>` só com o Plano 17 já na `main` (`git fetch origin && git log --oneline origin/main -- drizzle/meta/_journal.json`); se ainda não entrou, gerar em cima da `main` do momento e refazer os passos 2–8 depois.
2. **Antes de abrir o PR 2, e de novo se outra migration entrar na `main` antes do merge:** guardar `<G>` e `<R>` fora do repositório (`git diff --name-only --diff-filter=A origin/main...HEAD -- drizzle/`; `cp` para `../migrations-18/`), anotando as edições à mão feitas em `<G>` (comentários) e o SQL inteiro de `<R>`.
3. Atalho anti-conflito: commit que volta `drizzle/` ao merge-base (`git checkout $(git merge-base origin/main HEAD) -- drizzle/`), depois `git rebase origin/main` (conflito em `drizzle/`: fica a versão da `main`; no schema, juntar as duas mudanças).
4. `git diff origin/main -- drizzle/` vazio; `pnpm db:generate` → `<G>` novo; `diff` com o guardado e reaplicar as edições à mão.
5. Recriar `<R>` (`pnpm drizzle-kit generate --custom --name rls_patient_cadastro`) e colar o SQL guardado; conferir regras 2 e 8 (`app_enable_tenant_rls`, `app_enable_patient_rls`, `app_enable_audit`, a política e os gatilhos).
6. `_journal.json` com índices seguidos, `prevId` do snapshot novo = `id` do anterior, `pnpm drizzle-kit check` limpo; `grep -rn "<número antigo>" src test docs CLAUDE.md` e corrigir.
7. Com OK do dono (é apagar, mesmo em dev): parar `next dev` e `pnpm worker` da sessão, `dropdb --if-exists nutri_dev_a`, recriar e migrar do zero (script ou passos à mão do "Ambiente").
8. `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/patient-cadastro.test.ts` e a suíte toda antes do push. Sempre com `DATABASE_URL_MIGRATOR` (regra 7).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/ficha/tipos.ts` | Contrato do registro: `SecaoDaFicha`, `ItemDaSecao`, `ResumoDaSecao`, `DestinoDoAdicionar`, `ChaveDeAcao`, `TxDePaciente` (marcado) |
| `src/modules/ficha/secoes/{plano-alimentar,antropometria,gasto-energetico,anamneses,atendimentos,exames,exames-enviados,documentos}.ts` | As 8 seções do Plano 18 (resumo; `noApp` nas que o paciente vê, Tarefa 9) |
| `src/modules/ficha/secoes/index.ts` | `SECOES_DA_FICHA` (uma linha por seção; outros planos acrescentam no fim) |
| `src/modules/ficha/inicio.ts` | `secoesDoInicio`: as seções numa transação `nutri` |
| `src/modules/ficha/cabecalho.ts` | `carregarCabecalho` (`cache()` por id) e `lerCabecalho` |
| `src/modules/ficha/incompleto.ts` | Presença dos campos e texto da nota "Cadastro incompleto" |
| `src/modules/ficha/no-app.ts` | `noAppDoPaciente` (contexto `nutri` + paciente `semConta`) |
| `src/modules/ficha/textos.ts` | `MSG_FICHA`, `MSG_NO_APP` |
| `src/db/schema/pacientes.ts` (modificar) | Tabela `patient_cadastro` (`patientCadastro`, `PatientCadastroRow`) |
| `drizzle/<G>_patient_cadastro.sql` (gerada) + `drizzle/<R>_rls_patient_cadastro.sql` (custom) | Tabela; RLS, política sem conta, auditoria, gatilhos |
| `src/modules/pacientes/cpf.ts` | `normalizarCpf`, `cpfValido`, `formatarCpf` |
| `src/modules/pacientes/cadastro.ts` | Campos novos: tipos, validação, listas fechadas e rótulos (`MSG_CADASTRO`), `cadastroDoPaciente`, gravação com pré-checagem |
| `src/modules/pacientes/pacientes.ts` (modificar) | `pacienteSchema`, `criarPaciente`/`atualizarPaciente` com o cadastro, `buscarPaciente` com `nome_social`, `listarPacientes` nova |
| `src/app/painel/pacientes/[id]/{abas.tsx,layout.tsx,page.tsx}` (modificar) | Abas, cabeçalho, Início |
| `src/app/painel/pacientes/[id]/perfil/page.tsx` | Aba Perfil (cadastro, Acesso ao app, Etiquetas) |
| `src/app/painel/pacientes/[id]/app/page.tsx` | "No app do paciente" |
| `src/app/painel/pacientes/[id]/inicio/{adicionar.tsx,secao.tsx,cartao-no-app.tsx}` | Diálogo Adicionar (cliente), seção `<details>`, cartão |
| `src/components/foco-na-ancora.tsx` | Foco no título apontado pela âncora (destinos do Adicionar) |
| `src/app/painel/pacientes/{page.tsx,paciente-form.tsx,valores.ts,actions.ts}` (modificar), `menu-da-linha.tsx` (novo) | Lista, formulário em seções, menu por linha |
| `src/modules/pacientes/{lgpd.ts,exportacao-job.ts,prontuario-pdf.tsx}` (modificar) | Anonimização, rede, `dados.json`, PDF |
| `src/modules/ia/nome-social.ts` + `resumo-dados.ts`, `rascunho-dados.ts`, `nutri-paciente/contexto.ts` (modificar) | Nome social na máscara |
| `src/db/tenant.ts` (modificar) | `SEM_CONTA_PERMITIDOS` e comentários de `semConta` |
| `src/modules/ajuda/conteudo.ts` (modificar) | Guias `inicio-paciente` e `perfil-paciente`; `pacientes` v2; `prontuario` v3 |
| `e2e/ficha.spec.ts`, `e2e/cadastro.spec.ts` | E2E do PR 1 e do PR 2 |

---

## PR 1 — Fundação (sem migration)

### Task 1: Registro de seções — contrato e as 8 seções

**Files:**
- Create: `src/modules/ficha/tipos.ts`, `src/modules/ficha/secoes/*.ts` (8 arquivos), `src/modules/ficha/secoes/index.ts`, `src/modules/ficha/inicio.ts`, `src/modules/ficha/textos.ts`
- Test: `src/modules/ficha/secoes.test.ts` (Testcontainers), `src/modules/ficha/registro.test.ts` (fonte)

**Interfaces:**
- Produces:
```ts
// tipos.ts
export type ItemDaSecao = { id: string; rotulo: string; data: string /* AAAA-MM-DD no fuso */; situacao?: string; noApp: boolean; href: string };
export type ResumoDaSecao = { total: number; ultimos: ItemDaSecao[] }; // no máximo 3, mais recentes primeiro
declare const marca: unique symbol;
export type TxDePaciente = Tx & { readonly [marca]: 'paciente' }; // só no-app.ts cria (Tarefa 9)
export type ChaveDeAcao = 'criar-receita' | 'criar-parecer';
export type DestinoDoAdicionar = { href: string } | { acao: ChaveDeAcao };
export type TenantDaSecao = Pick<TenantRow, 'fuso' | 'documentosLiberados' | 'examesPacienteAtivadoEm'>;
export type PacienteDaSecao = Pick<PatientRow, 'id' | 'status' | 'anonimizadoEm'>;
export type SecaoDaFicha = {
  id: string; titulo: string; aba: string; // segmento da aba do "Ver todos" ('' = Início)
  disponivel(t: TenantDaSecao, p: PacienteDaSecao, total: number): boolean; // `total` só para a RN-192 (envios)
  resumo(tx: Tx, patientId: string, fuso: string): Promise<{ total: number; ultimos: Omit<ItemDaSecao, 'noApp'>[] }>;
  adicionar?: readonly { grupo: 'avaliacoes' | 'prescricoes'; rotulo: string; destino: DestinoDoAdicionar }[]; // lista: Documentos tem Receita e Parecer nutricional
  noApp?: { contar(tx: TxDePaciente, patientId: string): Promise<number>; visiveis(tx: TxDePaciente, patientId: string, ids: string[]): Promise<string[]> };
};
// secoes/index.ts
export const SECOES_DA_FICHA: readonly SecaoDaFicha[];
// inicio.ts
export type SecaoNoInicio = { id: string; titulo: string; aba: string; resumo: ResumoDaSecao };
export async function secoesDoInicio(ctx: TenantContext, tenant: TenantDaSecao, paciente: PacienteDaSecao, deps?: { db?: Db }): Promise<SecaoNoInicio[]>;
```
- `secoesDoInicio` aceita só `ctx.role === 'nutri'`, roda **todas** as seções numa transação (`withTenant`), uma consulta por seção (`count(*) over ()` + `limit 3`, ou `count` e os 3 últimos), com os índices existentes; `noApp: false` em todo item (o selo chega na Tarefa 9). Nenhuma seção importa `auditRead` (guarda de fonte).
- Seções e rótulos (spec RN-278): `plano-alimentar` ("Plano alimentar", situação Rascunho/Publicado/Arquivado; `adicionar` prescrições, `{ href: 'plano-alimentar' }`), `antropometria` ("Avaliação"; `{ href: 'antropometria#nova-avaliacao' }`), `gasto-energetico` ("Cálculo"; `#novo-calculo`), `anamneses` ("Anamnese", sem o nome do modelo; `{ href: 'anamnese#modelo-titulo' }`), `atendimentos` ("Atendimento"; `#novo-atendimento`), `exames` ("Exame", sem o nome; `#novo-exame`), `exames-enviados` ("Envio do paciente", situação do envio; `disponivel` = `examesPacienteAtivadoEm !== null || total > 0`; sem `adicionar`), `documentos` ("Receita"/"Parecer nutricional" de `TIPO_DOCUMENTO_ROTULO`, situação; `disponivel` = `documentosLiberados`; `adicionar` com duas entradas de prescrições: `{ acao: 'criar-receita' }` e `{ acao: 'criar-parecer' }`). `href` de cada item: a aba com o id quando a aba abre o item (ex.: `atendimentos/{id}`), senão a aba.
- `textos.ts`: `MSG_FICHA` com os títulos, rótulos, "Nenhum registro ainda.", "Ver todos", "Adicionar ao prontuário", grupos, dica e "Fechar" (spec §8.3).

- [ ] **Step 1: Testes que falham.** `secoes.test.ts` (fábricas de `test/pacientes.ts`):
  - `chaves exatas` — cada item de cada seção tem exatamente `id`, `rotulo`, `data`, `situacao?`, `noApp`, `href` (`Object.keys(...).sort()`), e o objeto de cada seção só `id`, `titulo`, `aba`, `resumo`.
  - `contador e 3 últimos` — 5 avaliações → `total` 5, 3 itens do mais recente ao mais antigo; empate de data desempata por `created_at`.
  - `sem conteúdo clínico` — anamnese do modelo "Anamnese gestante" e exame "Glicemia": `JSON.stringify` das seções não contém "gestante" nem "Glicemia".
  - `sem trilha` — contagem de `audit_log` igual antes e depois de `secoesDoInicio`.
  - `documentos desligados` e `envios` (RN-192) — a seção some conforme `disponivel`.
  - `outro tenant não vê` — paciente de B pelo ctx de A → totais 0.
  - `papel` — `ctx.role` diferente de `nutri` → erro.
  `registro.test.ts`: a ordem de `SECOES_DA_FICHA` é a da RN-278; nenhum arquivo de `src/modules/ficha/secoes/` cita `auditRead` nem `semConta`; `id`s únicos; todo `adicionar.destino` é `href` relativo sem `/` inicial ou `acao` de `ChaveDeAcao`.
- [ ] **Step 2:** `pnpm vitest run src/modules/ficha` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm vitest run src/modules/ficha && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(ficha): registro de seções do Início (P18-01)`.

**Pronto quando:** os 8 arquivos e o `index.ts` existem, os testes passam, e um plano novo pendura uma seção com um arquivo e uma linha. Revisão: `revisor-rls` (uma transação, sem `auditRead`, projeções).

---

### Task 2: Abas Início e Perfil

**Files:**
- Modify: `src/app/painel/pacientes/[id]/abas.tsx` (`ABAS`: `{ seg: '', rotulo: 'Início' }`, `{ seg: 'perfil', rotulo: 'Perfil' }` logo depois, a última `{ seg: 'historico', rotulo: 'Histórico', nome: 'Histórico de acessos' }` → `aria-label`; Início ativo também em `${base}/app` e `${base}/resumo-ia`; atualizar o comentário da medição a 1280 px)
- Create: `src/app/painel/pacientes/[id]/perfil/page.tsx` — move de `[id]/page.tsx` as seções "Cadastro" (`PacienteForm` como está), "Acesso ao app" (título trocado de "Acesso ao portal"; texto, convite de WhatsApp e "Reenviar convite") e "Etiquetas"; `[id]/page.tsx` fica só com o bloco da IA (US-120) até a Tarefa 4
- Create: `src/components/foco-na-ancora.tsx` (cliente: no mount, se `location.hash` aponta para um elemento, `focus()` nele); usar nos destinos do Adicionar: `antropometria/page.tsx`, `gasto-energetico/page.tsx`, `exames/page.tsx`, `atendimentos/page.tsx` (os `h2` `nova-avaliacao`, `novo-calculo`, `novo-exame`, `novo-atendimento` ganham `tabIndex={-1}`) e `anamnese/page.tsx` (`<h2 id="modelo-titulo" tabIndex={-1}>` antes do seletor, texto "Preencher anamnese")
- Modify: `src/app/painel/pacientes/actions.ts` (`revalidatePath` do Perfil onde hoje revalida o Resumo; `reenviarConviteAction` e `salvarEtiquetasAction` continuam)
- Modify: `src/modules/ajuda/conteudo.ts`, guia `prontuario`: `versao` 2 → 3 (comentário `Plano 18: abas Início e Perfil`), passo `abas-prontuario` com o texto da spec §8.2 e as `ajuda` revistas (§8.2); `src/modules/ajuda/conteudo.test.ts` (os dois `toBe(2)` do `prontuario` → 3)
- Modify: `e2e/painel-rotas.ts` (rotas `perfil`; a do Resumo vira Início), `e2e/acessibilidade-painel.spec.ts`, `e2e/pacientes.spec.ts` (o que procurava o cadastro no Resumo passa ao Perfil)
- Test: `src/app/painel/pacientes/[id]/abas.test.tsx`, `src/app/painel/pacientes/[id]/perfil/page.test.ts`, `src/components/foco-na-ancora.test.tsx`

- [ ] **Step 1: Testes que falham:** `abas.test.tsx` (render com `usePathname` falso): rótulos e ordem; "Histórico" com `aria-label="Histórico de acessos"` (o rótulo visível está contido no nome); Início com `aria-current="page"` em `/painel/pacientes/ID`, `/app` e `/resumo-ia`, e não em `/perfil`. `perfil/page.test.ts`: renderiza o formulário, "Acesso ao app" e "Etiquetas"; bloqueado → só leitura com o aviso. `foco-na-ancora.test.tsx`: com `#novo-exame`, o foco vai ao elemento. `conteudo.test.ts`: `prontuario` na versão 3.
- [ ] **Step 2:** `pnpm vitest run "src/app/painel/pacientes/[id]/abas.test.tsx" "src/app/painel/pacientes/[id]/perfil" src/components/foco-na-ancora.test.tsx src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar (ler `node_modules/next/dist/docs/` sobre `PageProps` tipado e `revalidatePath` com `'layout'`).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS; axe da faixa a 1280 px com Documentos e IA Nutri ligados (`pnpm test:e2e e2e/acessibilidade-painel.spec.ts`, com a `APP_URL` da sessão) sem "incomplete".
- [ ] **Step 5:** commit `feat(ficha): abas Início e Perfil (P18-02)`.

**Pronto quando:** o cadastro abre no Perfil, a faixa cabe inteira a 1280 px, e o E2E existente de pacientes passa. Revisão: `revisor-interface`.

---

### Task 3: Cabeçalho com a última avaliação

**Files:**
- Create: `src/modules/ficha/cabecalho.ts`
- Modify: `src/app/painel/pacientes/[id]/layout.tsx` (linha de medidas com `print:hidden`; selo "Peso oculto no app"); `src/app/painel/pacientes/[id]/impressao.test.ts`
- Test: `src/modules/ficha/cabecalho.test.ts` (Testcontainers), `src/modules/ficha/cabecalho-fonte.test.ts`

**Interfaces:**
- Produces:
```ts
export type Cabecalho = { data: string; alturaM: string | null; pesoKg: string | null; imc: string | null; gordura: string | null } | null; // já formatados (pt-BR)
export async function lerCabecalho(ctx: TenantContext, patientId: string, deps?: { db?: Db }): Promise<Cabecalho>; // um auditRead quando há avaliação
export const carregarCabecalho: (patientId: string) => Promise<Cabecalho>; // cache() do React; ctx de carregarProntuario(patientId)
export function linhaDoCabecalho(c: Cabecalho): string; // "Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura 28,1%" / "Sem avaliação antropométrica."
```
- `lerCabecalho`: `anthropometry` do paciente `order by data desc, created_at desc limit 1`, só as colunas das medidas e a data; `auditRead(tx, { entidade: 'antropometria', entidadeId: a.id, patientId })` na mesma transação. Formato da RN-275 (altura em metros com vírgula e duas casas; peso, IMC e gordura com uma casa; gordura omitida quando nula).
- O selo usa `paciente.pesoOcultoNoAppEm` que `carregarProntuario` já traz.

- [ ] **Step 1: Testes que falham:** `cabecalho.test.ts`: `formato` (1,65 m · 72,4 kg · IMC 26,6 · 28,1%); `sem gordura` (sem o trecho "gordura"); `sem avaliação` → `null` e nenhum `ler` gravado; `uma leitura` — `lerCabecalho` com avaliação grava exatamente uma linha `ler`/`antropometria`; `outro tenant` → `null`. `cabecalho-fonte.test.ts`: `carregarCabecalho` é `cache(` com parâmetro `patientId: string`; `layout.tsx` e as páginas só chamam `carregarCabecalho`, nunca `lerCabecalho`. `impressao.test.ts`: troca o `not.toContain('print:hidden')` do layout inteiro por "o `h1` não está dentro de elemento `print:hidden`" e "a linha de medidas tem `print:hidden`" (mock de `@/modules/ficha/cabecalho`).
- [ ] **Step 2:** `pnpm vitest run src/modules/ficha/cabecalho "src/app/painel/pacientes/[id]/impressao.test.ts"` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(ficha): cabeçalho com a última avaliação (P18-03)`.

**Pronto quando:** o cabeçalho mostra as medidas com a data, a impressão as omite e grava-se uma leitura de antropometria por execução do layout. Revisão: `revisor-rls` (auditoria) e `revisor-interface` (impressão).

---

### Task 4: Página Início — Resumo, seções e Adicionar

**Files:**
- Modify: `src/app/painel/pacientes/[id]/page.tsx` (Início: botão Adicionar, cartão Resumo, bloco da IA da US-120 como está, seções do registro)
- Create: `src/app/painel/pacientes/[id]/inicio/adicionar.tsx` (cliente: `<dialog>` com `showModal()`, foco no título ao abrir, devolvido ao botão ao fechar, Esc fecha; itens por `href` com `<Link>` e por `acao` com `<form action>`), `.../inicio/secao.tsx` (`<details>`/`<summary>` com `<h3>` "{Título} ({n})", `block min-h-11 py-2`, sem `flex`; itens e "Ver todos" — nome acessível "Ver todos: {Título}" — no corpo; `open` quando `total > 0`), `.../inicio/acoes.ts` (mapa `ChaveDeAcao` → `criarReceitaAction`/`criarParecerAction` de `documentos/actions.ts`, ligadas ao paciente)
- Modify: `src/modules/ajuda/conteudo.ts` — guia novo `inicio-paciente` (`versao` 1, `padrao: new RegExp(\`^/painel/pacientes/${ID}$\`)`, posto **antes** do `prontuario` em `GUIAS`), passos `cabecalho-paciente`, `abas-prontuario`, `adicionar-prontuario`, `secoes-inicio` (textos da spec §8.2–8.3; o passo `no-app-cartao` entra na Tarefa 9); `data-guia` nos elementos
- Create: `e2e/ficha.spec.ts` (bloco de IP novo no cabeçalho, sem colidir com os existentes)
- Test: `src/app/painel/pacientes/[id]/inicio/adicionar.test.tsx`, `.../inicio/secao.test.tsx`, `src/app/painel/pacientes/[id]/page.test.ts`, `src/modules/ajuda/conteudo.test.ts`

Cartão Resumo (RN-276 sem a nota da RN-269, que vem na Tarefa 7): "Aniversário: {dia} de {mês}", "Paciente desde {dd/mm/aaaa}" (`created_at` no fuso), "Plano alimentar publicado em {data}" / "Nenhum plano publicado". Adicionar: grupos "Avaliações" e "Prescrições", dica "Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético.", "Fechar"; ausente para bloqueado ou anonimizado; Receita e Parecer nutricional só com `documentosLiberados`.

- [ ] **Step 1: Testes que falham:** `adicionar.test.tsx`: grupos e itens na ordem; sem documentos → sem "Receita" e "Parecer nutricional"; abrir põe o foco no título, fechar devolve ao botão. `secao.test.tsx`: `<h3>` dentro do `<summary>`; "Ver todos" fora do `<summary>`; vazio "Nenhum registro ainda." e `<details>` fechado. `page.test.ts` (mocks como `impressao.test.ts`): bloqueado sem Adicionar; arquivado com Adicionar; seções na ordem do registro. `conteudo.test.ts`: `inicio-paciente` casa `/painel/pacientes/ID` e não `/perfil`; vem antes de `prontuario`. `e2e/ficha.spec.ts`: do Início, Adicionar → Antropometria abre a aba com o foco em "Nova avaliação" (2 cliques); Adicionar → Anamnese abre a aba com o foco no seletor (nunca o 404); Adicionar → Receita cria o rascunho (consultório com documentos); seção → item (2 cliques); axe com o diálogo aberto, claro e escuro (`escolherTema`, voltando a "Igual ao aparelho" no `afterAll`).
- [ ] **Step 2:** `pnpm vitest run "src/app/painel/pacientes/[id]/inicio" "src/app/painel/pacientes/[id]/page.test.ts" src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar; o manual técnico das abas (cap. 04 §4.2 e cap. 05 §5.8.1, guia novo) pelo `guardiao-manual`, só o que o PR 1 muda.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint && pnpm test` → PASS; `pnpm test:e2e e2e/ficha.spec.ts e2e/pacientes.spec.ts e2e/acessibilidade-painel.spec.ts` (ver "Ambiente") → PASS.
- [ ] **Step 5:** commit `feat(ficha): página Início com seções e Adicionar (P18-04)`.

**Pronto quando:** o PR 1 está completo (abrir com o fluxo de "Depois das tarefas", aplicado ao PR 1); CS-260 verde no E2E. Revisão: `revisor-interface` (diálogo, `<details>`, foco, guia).

---

## PR 2 — Cadastro, lista e "No app" (com migration)

### Task 5: Banco — `patient_cadastro`, RLS, auditoria e guardas

**Files:**
- Modify: `src/db/schema/pacientes.ts` (tabela `patientCadastro`), `src/db/schema/index.ts` (já reexporta `pacientes.ts`; conferir)
- Create: `drizzle/<G>_patient_cadastro.sql` (`pnpm db:generate`), `drizzle/<R>_rls_patient_cadastro.sql` (`pnpm drizzle-kit generate --custom --name rls_patient_cadastro`) — procedimento "Migration" acima
- Modify: `test/isolamento.test.ts` — só acrescentar: `FABRICAS.patient_cadastro: (t, p) => sql\`insert into patient_cadastro (tenant_id, patient_id, estado_civil) values (${t}, ${p}, 'casado')\`` (`cpf` nulo); `SEM_DELETE` e `IMUTAVEIS` com `patient_cadastro` (comentário `Plano 18: patient_cadastro_colunas_fixas recusa mudar tenant_id/patient_id com 42501 antes da RLS; patient_cadastro_sem_apagar recusa o DELETE fora do worker`); em `SO_APAGA.patients`, acrescentar `and not exists (select 1 from patient_cadastro c where c.tenant_id = patients.tenant_id and c.patient_id = patients.id)`. **Não** entra em `SO_INSERE`, `COM_MAE`, `ULTIMAS` nem `DELETE_REVOGADO`
- Test: `src/db/patient-cadastro.test.ts`

Tabela (spec §9.1): `id uuid pk default gen_random_uuid()`, `tenant_id`, `patient_id` (FK composta `(tenant_id, patient_id)` → `patients (tenant_id, id)`, `NO ACTION`), UNIQUE `patient_cadastro_paciente_unique (tenant_id, patient_id)`, `cpf` (CHECK `^[0-9]{11}$`; índice único parcial `patient_cadastro_cpf_unico (tenant_id, cpf) where cpf is not null`), `nome_social` (2–120), `identidade_genero`, `estado_civil`, `escolaridade` (CHECK nas listas da US-260), `ocupacao` (2–80), `nacionalidade` (2–60), `naturalidade` (2–80), `telefone_fixo_e164` (`^\+[1-9][0-9]{7,14}$`), `cep` (`^[0-9]{8}$`), `logradouro` (2–120), `numero` (1–10), `complemento` (1–60), `bairro` (2–60), `cidade` (2–60), `uf` (27 UFs), `observacao` (1–1000), `created_at`, `updated_at`. CHECKs de tamanho com `char_length`, nomeados `patient_cadastro_<coluna>_check`.

Custom `<R>` (molde: `0102_rls_exames_enviados.sql`, `exam_submissions_sem_apagar`):
- `SELECT app_enable_tenant_rls('patient_cadastro'); SELECT app_enable_patient_rls('patient_cadastro'); SELECT app_enable_audit('patient_cadastro', 'patients'); REVOKE TRUNCATE ON patient_cadastro FROM nutri_app_role;`
- `CREATE POLICY patient_cadastro_paciente_com_conta ON patient_cadastro AS RESTRICTIVE FOR ALL USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL) WITH CHECK (…igual…);`
- Gatilho `patient_cadastro_colunas_fixas` (BEFORE UPDATE): `NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id` → `42501`.
- Gatilho `patient_cadastro_sem_apagar` (BEFORE DELETE): passa só com `app_current_role() = 'worker'` e `exists (select 1 from patients p where p.tenant_id = OLD.tenant_id and p.id = OLD.patient_id and p.anonimizado_em is not null)`; senão `42501`. Funções `SECURITY INVOKER`, `SET search_path`.

- [ ] **Step 1: Testes que falham** em `patient-cadastro.test.ts`:
  - `público não lê nem grava` (0 linhas; INSERT recusado).
  - `paciente com login lê só a própria linha e não grava` (INSERT/UPDATE/DELETE recusados).
  - **Review Focus 1** `paciente semConta não lê nem a própria linha` — `withTenant({ role: 'paciente', patientId, semConta: true })` → 0 linhas.
  - `colunas fixas` — UPDATE de `tenant_id` → `42501`; `update … set tenant_id = tenant_id` passa.
  - `apagar` — DELETE pela `nutri` → `42501`; pelo `worker` com titular não anonimizado → `42501`; com `anonimizado_em` → passa.
  - `auditoria` — INSERT e UPDATE pela `nutri` gravam `audit_log` com entidade `patients`, `entidade_id` = id do cadastro e o titular; nada do conteúdo da linha.
  - `CPF único por consultório` — dois pacientes do mesmo tenant com o mesmo CPF → 23505; tenants diferentes → passa; CPF nulo em vários → passa.
  - `CHECKs` — um caso de fronteira por coluna (tamanho e lista).
- [ ] **Step 2:** `pnpm vitest run src/db/patient-cadastro.test.ts` → FAIL.
- [ ] **Step 3:** schema, `pnpm db:generate`, migration custom, `pnpm db:migrate` (com `DATABASE_URL_MIGRATOR` do `.env.local` da sessão).
- [ ] **Step 4:** `pnpm vitest run src/db/patient-cadastro.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/migrate.test.ts` → PASS.
- [ ] **Step 5:** commit `feat(pacientes): tabela patient_cadastro com RLS e auditoria (P18-05)`.

**Pronto quando:** guardas e isolamento verdes, a política nega o `semConta`, e `drizzle/` só tem `<G>` e `<R>` a mais que a `main`. Revisão: `revisor-rls` (obrigatória: política, gatilhos, listas do isolamento).

---

### Task 6: Regras do cadastro — CPF, validação e gravação

**Files:**
- Create: `src/modules/pacientes/cpf.ts`, `src/modules/pacientes/cadastro.ts`
- Modify: `src/modules/pacientes/pacientes.ts` (`pacienteSchema` com os campos novos e as mensagens da US-260; `ErrosPaciente` com as chaves novas; `criarPaciente`/`atualizarPaciente` gravam o cadastro na mesma transação; `set()` de `atualizarPaciente` continua listando coluna a coluna; `buscarPaciente` com `left join` projetando só `nomeSocial`; `PatientRow` devolvido como `PatientRow & { nomeSocial: string | null }`)
- Test: `src/modules/pacientes/cpf.test.ts`, `src/modules/pacientes/cadastro.test.ts` (Testcontainers), `src/modules/pacientes/pacientes.test.ts` (casos novos)

**Interfaces:**
- Consumes: Tarefa 5.
- Produces:
```ts
// cpf.ts
export function normalizarCpf(s: string): string | null; // tira pontos, traço e espaços; null se não sobrar 11 dígitos
export function cpfValido(digitos: string): boolean; // dígitos verificadores; 11 iguais = inválido
export function formatarCpf(digitos: string): string; // 000.000.000-00
// cadastro.ts
// ESTADOS_CIVIS, ESCOLARIDADES, IDENTIDADES_DE_GENERO, UFS: listas fechadas `{ valor, rotulo }[]` com os rótulos da spec §8.4
// MSG_CADASTRO: cpfInvalido 'CPF inválido. Confira os números.', cpfRepetido 'Já existe um paciente com este CPF neste consultório.',
//   abrirExistente 'Abrir o cadastro existente (abre em nova aba)', e as demais mensagens, rótulos e dicas da US-260 e da §8.4
export type CadastroComplementar = Record<'cpf' | 'nomeSocial' | 'identidadeGenero' | 'estadoCivil' | 'escolaridade' | 'ocupacao' | 'nacionalidade' | 'naturalidade' | 'telefoneFixo' | 'cep' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'observacao', string | null>; // listas como uniões literais na implementação
export function validarCadastro(input: Record<string, unknown>): { ok: true; valor: CadastroComplementar } | { ok: false; erros: Partial<Record<keyof CadastroComplementar, string>> };
export async function gravarCadastro(tx: Tx, a: { tenantId: string; patientId: string; valor: CadastroComplementar }): Promise<void>; // pré-checagem + upsert
export async function cadastroDoPaciente(ctx: TenantContext, patientId: string, deps?: { db?: Db }): Promise<CadastroComplementar | null>; // auditRead entidade patients
export class CpfRepetidoError extends PacienteError { outroId: string | null } // null quando o outro está bloqueado
```
- `validarCadastro` confere **todas** as regras dos CHECKs (D23): tamanhos com `trim`, listas fechadas, CEP 8 dígitos, telefone fixo por `normalizarTelefone`, CPF por `normalizarCpf` + `cpfValido`. Mensagens da US-260, inclusive "Use entre {min} e {max} caracteres" no endereço. Nenhuma mensagem repete o valor.
- `gravarCadastro`: linha só nasce com algum campo preenchido (RN-260); depois de nascer, esvaziar grava tudo nulo. Com CPF: `pg_advisory_xact_lock(hashtext('patient_cadastro_cpf'), hashtext(${tenantId} || ':' || ${cpf}))`, depois `select c.patient_id, p.status from patient_cadastro c join patients p … where c.cpf = $cpf and c.patient_id <> $patientId` → `CpfRepetidoError` (`outroId` nulo se `bloqueado`). Upsert em `(tenant_id, patient_id)`. Um 23505 residual vira a mesma `CpfRepetidoError`.
- `criarPaciente`/`atualizarPaciente`: depois de `carregarPacienteParaEscrita` (na edição), mesma transação; `PacienteError` com `erros.cpf`.

- [ ] **Step 1: Testes que falham.** `cpf.test.ts`: `529.982.247-25` válido e normalizado `52998224725`; `111.111.111-11` inválido; dígito trocado inválido; 10 dígitos → `null`; `formatarCpf`. `cadastro.test.ts`:
  - `cria com os campos novos na mesma transação` (cenário da US-260) e `sem campo novo não cria linha`.
  - `CPF inválido` → `erros.cpf` = `CPF inválido. Confira os números.`, e a mensagem não contém os dígitos.
  - **Review Focus 3** `CPF repetido não chega ao índice` — espiar o pool: nenhum erro 23505 do banco; `CpfRepetidoError` com `outroId`; com o outro `bloqueado`, `outroId` nulo.
  - `corrida` — duas conexões gravando o mesmo CPF ao mesmo tempo: uma passa, a outra recebe `CpfRepetidoError` (a trava serializa).
  - `fronteiras não violam CHECK` — para cada campo, o maior e o menor valor aceitos por `validarCadastro` gravam sem 23514; um a mais/menos é recusado por `validarCadastro` antes do banco.
  - `log sem dado` (RNF-262) — "Salvar" com erro de CPF, CEP e observação de teste: o log capturado (`vi.spyOn` no logger) não contém os valores.
  - `bloqueado não grava` → `PacienteBloqueadoError`.
  - `cadastroDoPaciente` grava `ler` de `patients`; outro tenant → `null`.
  - **Review Focus 4** `buscarPaciente traz só nomeSocial do cadastro` — chaves do objeto devolvido: as de `PatientRow` + `nomeSocial`, sem `cpf`, `observacao`, `cep`.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/cpf.test.ts src/modules/pacientes/cadastro.test.ts src/modules/pacientes/pacientes.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(pacientes): CPF e cadastro complementar (P18-06)`.

**Pronto quando:** o cadastro grava e lê pelas regras da spec, o CPF repetido é recusado sem passar pelo índice e nada do cadastro vai a log. Revisão: `revisor-rls` (trava, auditoria) e `normas-cfn-lgpd` (CPF, mensagens).

---

### Task 7: Formulário em seções, Perfil, nome social e "Cadastro incompleto"

**Files:**
- Modify: `src/app/painel/pacientes/paciente-form.tsx` (seções `fieldset`/`legend`: Dados gerais; Contato e endereço — celular, opt-in e convite por WhatsApp como hoje, logo abaixo do celular, fixo e endereço; Observação, com o aviso e o contador "{n} de 1.000 caracteres"; rótulos e dicas da spec §8.4), `src/app/painel/pacientes/valores.ts` (valores do formulário com os campos novos; `textoDoAcesso` recebe o `status`: arquivado → "Sem acesso (arquivado)", bloqueado → "Sem acesso (bloqueado)"), `src/app/painel/pacientes/actions.ts` (`CpfRepetidoError` → erro do campo + link "Abrir o cadastro existente (abre em nova aba)" com `target="_blank"` quando há `outroId`; nada do digitado se perde), `src/app/painel/pacientes/novo/page.tsx` (mesmo formulário sem Acesso ao app e Etiquetas), `src/app/painel/pacientes/[id]/perfil/page.tsx` (lê `cadastroDoPaciente`)
- Modify: `src/app/painel/pacientes/[id]/layout.tsx` (com nome social: `h1` com `<span className="print:hidden">{nomeSocial}</span><span className="hidden print:inline">{nome}</span>`, abaixo `<p className="print:hidden">Nome de registro: {nome}</p>` e `<p className="hidden print:block">Nome social: {nomeSocial}</p>`)
- Create: `src/modules/ficha/incompleto.ts`; Modify: `src/app/painel/pacientes/[id]/page.tsx` (nota no cartão Resumo, `Aviso tipo="aviso" papel="nenhum"`, link "Completar no Perfil")
- Modify: `src/app/painel/pacientes/[id]/privacidade/page.tsx` (com nome social, instrução "Digite o nome de registro do paciente ({nome}) exatamente como está no cadastro para confirmar."; `MSG_LGPD` ganha o texto com o nome)
- Modify: `src/modules/ajuda/conteudo.ts` — guia novo `perfil-paciente` (`versao` 1, `padrao` `^/painel/pacientes/ID/perfil$`, antes do `prontuario`) com o passo `cadastro-paciente` (texto da §8.4); o guia `pacientes` ganha o mesmo passo para `/novo` (a subida de versão do `pacientes` fica na Tarefa 8, que muda os outros textos dele)
- Test: `src/app/painel/pacientes/valores.test.ts`, `src/app/painel/pacientes/actions.test.ts`, `src/modules/ficha/incompleto.test.ts`, `src/app/painel/pacientes/[id]/impressao.test.ts`, `src/app/painel/pacientes/[id]/privacidade/page.test.ts`, `src/modules/ajuda/conteudo.test.ts`

**Interfaces:**
- Produces:
```ts
// incompleto.ts
export type PresencaDoCadastro = Record<'dataNascimento' | 'sexo' | 'identidadeGenero' | 'estadoCivil' | 'nacionalidade' | 'naturalidade' | 'escolaridade' | 'ocupacao' | 'endereco' | 'telefone', boolean>;
export async function presencaDoCadastro(tx: Tx, patientId: string): Promise<PresencaDoCadastro>; // só `campo is not null`, nunca o valor; sem auditRead
export function textoDoIncompleto(p: PresencaDoCadastro): string | null; // até 3: "Cadastro incompleto: faltam estado civil e endereço."; 4+: "Cadastro incompleto: faltam {n} dados."
```

- [ ] **Step 1: Testes que falham:** `incompleto.test.ts`: dois itens (texto exato com "e"); três (vírgula e "e"); seis → "faltam 6 dados."; completo → `null`; endereço sem complemento conta como presente; celular **ou** fixo basta; `presencaDoCadastro` não grava `ler` e a consulta só seleciona expressões `is not null` (espiar o SQL). `valores.test.ts`: `textoDoAcesso` com arquivado e bloqueado (mesmo com `userId`). `actions.test.ts`: CPF repetido devolve o erro do campo, o link com `outroId` e os valores digitados; bloqueado → sem link. **Review Focus 5** `impressao.test.ts`: com nome social, no HTML impresso (classes `print:`) o nome civil vem antes de "Nome social: …"; o `h1` não está dentro de `print:hidden`. `privacidade/page.test.ts`: instrução com o nome de registro quando há nome social. `conteudo.test.ts`: `perfil-paciente` casa `/perfil` e vem antes de `prontuario`.
- [ ] **Step 2:** `pnpm vitest run src/modules/ficha/incompleto.test.ts src/app/painel/pacientes "src/app/painel/pacientes/[id]/impressao.test.ts" src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar (componentes base V2; `Campo` com `aria-describedby`; `noValidate` para as mensagens do servidor).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): cadastro em seções e nome social na ficha (P18-07)`.

**Pronto quando:** Perfil e Novo paciente com as seções e os textos da spec; a impressão segue a Res. 594; a nota aparece com o texto certo. Revisão: `revisor-interface` (formulário, textos) e `normas-cfn-lgpd` (ordem dos nomes, aviso da Observação, dica do CPF, instrução da exclusão).

---

### Task 8: Lista de pacientes — abas, ordem e menu por linha

**Files:**
- Modify: `src/modules/pacientes/pacientes.ts` (`listarPacientes` nova), `src/app/painel/pacientes/page.tsx` (abas Ativos/Inativos/Todos com `aria-current`, link "Ver bloqueados", formulário GET com `aba` e `situacao` ocultos, "Ordenar por", colunas "Acesso ao app" e "Desde", só o nome exibido, região `role="status"` fixa acima da tabela com o texto de `?ok=`; título "Pacientes" com `tabIndex={-1}` e foco nele quando há `ok`), `src/app/painel/pacientes/actions.ts` (`arquivarDaListaAction`, `reativarDaListaAction`: chamam `arquivarPaciente`/`desarquivarPaciente` e `redirect` para a mesma URL com `ok=arquivado|reativado`)
- Create: `src/app/painel/pacientes/menu-da-linha.tsx` (cliente; disclosure "Ações de {nome}", Esc e clique fora fecham, foco volta ao botão, fecha ao escolher; painel fora do contêiner com `overflow`; itens por situação, RN-273; Arquivar/Reativar com `ConfirmarBotao` e os textos da §8.1; "Pedir exclusão (LGPD)" → `/painel/pacientes/{id}/privacidade#exclusao`)
- Modify: `src/modules/ajuda/conteudo.ts`, guia `pacientes`: `versao` 1 → 2 (comentário `Plano 18: abas da lista, Ações e o cadastro em seções`), `busca-pacientes` com o texto novo, passo novo `acoes-paciente`, `ajuda` trocadas (§8.1)
- Test: `src/modules/pacientes/pacientes.test.ts`, `src/app/painel/pacientes/page.test.ts`, `src/app/painel/pacientes/menu-da-linha.test.tsx`, `src/app/painel/pacientes/actions.test.ts`, `src/modules/ajuda/conteudo.test.ts`

**Interfaces:**
- Produces:
```ts
export type AbaDaLista = 'ativos' | 'inativos' | 'todos' | 'bloqueados';
export type OrdemDaLista = 'nome' | 'nome_desc' | 'recentes' | 'antigos';
export type FiltroDaLista = { aba: AbaDaLista; busca?: string; etiquetaId?: string; ordem: OrdemDaLista /* + ponto de extensão do local (D11): campos opcionais acrescentados por outros planos */ };
export type PacienteNaLista = Pick<PatientRow, 'id' | 'nome' | 'email' | 'status' | 'dataNascimento' | 'userId' | 'origem' | 'createdAt'> & { nomeSocial: string | null };
export function filtroDaUrl(sp: Record<string, string | string[] | undefined>): FiltroDaLista; // ?status=arquivado → inativos; ?status=bloqueado → bloqueados; desconhecido → padrão
export async function listarPacientes(ctx: TenantContext, filtro: FiltroDaLista, db?: Db): Promise<PacienteNaLista[]>;
```
- Busca em `unaccent(nome)`, `unaccent(nome_social)` e e-mail; ordem por `unaccent(lower(coalesce(nome_social, nome)))`, empate por `id`; limite `LIMITE_LISTA`; `auditRead` de "Etiquetas" só com `etiquetaId` (como hoje). Projeção exata (RN-272).

- [ ] **Step 1: Testes que falham:** `pacientes.test.ts` (`listarPacientes`): abas (ativo, arquivado e bloqueado em cada uma; "Todos" sem bloqueado); ordens e empate; nome social na busca pelos dois nomes e na ordem; `chaves exatas` do item (sem campo do cadastro além de `nomeSocial`); etiqueta continua gravando a leitura; sem etiqueta não grava. `filtroDaUrl`: `status=arquivado` → `inativos`; valor desconhecido → `ativos`. `page.test.ts`: `aria-current` na aba; campos ocultos `aba` e `situacao` no formulário; links das abas levam busca, etiqueta e ordem; "Sem acesso (arquivado)" na coluna; só o nome social na linha; região `role="status"` presente também sem `ok` (vazia). `menu-da-linha.test.tsx`: itens por situação; Esc fecha e devolve o foco; nome acessível "Ações de {nome}". `actions.test.ts`: arquivar pela lista apaga o convite pendente e redireciona com `ok=arquivado`; bloqueado → recusa. `conteudo.test.ts`: `pacientes` na versão 2 com `acoes-paciente`.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/pacientes.test.ts src/app/painel/pacientes src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): lista de pacientes com abas, ordem e ações (P18-08)`.

**Pronto quando:** a lista da spec §8.1 funciona por teclado, o link antigo `?status=arquivado` continua valendo e a lista não lê nada do cadastro além do nome social. Revisão: `revisor-interface` (menu, região viva, foco) e `revisor-rls` (projeção, auditoria da etiqueta).

---

### Task 9: "No app do paciente" — contagens, selo, cartão e página

**Files:**
- Create: `src/modules/ficha/no-app.ts`, `src/app/painel/pacientes/[id]/app/page.tsx`, `src/app/painel/pacientes/[id]/inicio/cartao-no-app.tsx`
- Modify: as seções com `noApp` — `secoes/{plano-alimentar,antropometria,atendimentos,documentos,exames-enviados}.ts` (`contar` e `visiveis` com os mesmos filtros em TypeScript da função do portal: plano `status = 'publicado'`; documentos com o filtro de `anonimizado_em` de `documentosDoPaciente`; envios não cancelados); `src/app/painel/pacientes/[id]/page.tsx` (cartão "No app do paciente" e o selo dos itens a partir de `visiveis`)
- Modify: `src/db/tenant.ts` — `SEM_CONTA_PERMITIDOS` com `'src/modules/ficha/no-app.ts'` (no fim) e os comentários de `semConta` e de `SEM_CONTA_PERMITIDOS` passam a citar "a contagem do No app, pela nutricionista, no contexto do paciente (Plano 18, D16)"; `CLAUDE.md` regra 1 (frase nova: o `no-app.ts` usa `semConta` só para contar, e `patient_cadastro` é negada a todo `semConta`)
- Modify: `src/modules/ajuda/conteudo.ts` — guia `inicio-paciente`: `versao` 1 → 2 (comentário `Plano 18, PR 2: o cartão No app`; o PR 1 já estará em produção), passo `no-app-cartao` e um item nas `ajuda` sobre a página "No app do paciente" (o `prontuario` não muda de novo)
- Test: `src/modules/ficha/no-app.test.ts` (Testcontainers), `src/modules/ficha/no-app-fonte.test.ts`, `src/app/painel/pacientes/[id]/app/page.test.ts`; `src/db/sem-conta-guarda.test.ts` passa sem mudança (lê `SEM_CONTA_PERMITIDOS`)

**Interfaces:**
- Consumes: Tarefas 1, 4, 5 (política sem conta), `situacaoDoAcesso` (`convite-paciente.ts`), `access_events`, `push_subscriptions`, `temParticipacao` (IA Nutri).
- Produces:
```ts
export type NoApp = {
  acesso: { estado: 'ativo' | 'pendente' | 'expirado' | 'sem_convite' | 'arquivado' | 'bloqueado'; ultimoAcesso: string | null; textoDoConvite: string | null };
  notificacoes: { aparelhos: number; whatsapp: boolean };
  pesoOculto: boolean; gorduraNoApp: boolean; iaNutri: 'ligada' | 'desligada' | null;
  contagens: Record<string, number> | null; // por id de seção + 'conteudos', 'diario30d'; null sem acesso ativo
  receitasSugeridas: number | null; // contexto nutri (D24)
  visiveis: Record<string, string[]>; // por seção, os ids pedidos que o paciente vê
};
export async function noAppDoPaciente(ctx: TenantContext, patientId: string, itens?: Record<string, string[]>, deps?: { db?: Db; agora?: Date }): Promise<NoApp>;
```
- Fluxo (RN-281): `ctx.role === 'nutri'` ou erro; parte 1 na sessão `nutri` (status, anonimização, acesso, último dia de `access_events`, aparelhos, WhatsApp, `peso_oculto_no_app_em`, IA Nutri, `mostrar_perc_gordura_paciente`, e as receitas: `meals.recipe_content_id` do plano `publicado` com `contents.status = 'publicado'`, distintas); parte 2 só com `status = 'ativo'`, sem `anonimizado_em` e com `user_id`: helper **não exportado** `comoPaciente(tenantId, patientId, fn)` abre `withTenant({ tenantId, role: 'paciente', patientId, semConta: true })`, confere `select current_setting('app.role') = 'paciente'`, faz o *cast* para `TxDePaciente` e roda `contar`/`visiveis` de cada seção, `count(*)` de `contents` visíveis (sem `liberarReceitasDoPlano`) e de `diary_entries` dos últimos 30 dias. Nenhum `auditRead`, nenhuma coluna de conteúdo.
- Página `[id]/app` e cartão: textos exatos da spec §8.5 e US-264 (`MSG_NO_APP`).

- [ ] **Step 1: Testes que falham.** `no-app.test.ts` — **Review Focus 2**, cenário único (paciente com conta pelo `test/portal.ts`): conteúdo publicado só para a etiqueta "gestante" (paciente sem a etiqueta), receita sugerida no plano publicado só para "gestante", documento emitido, cancelado e de paciente anonimizado, plano arquivado e publicado, envio cancelado e não cancelado, peso oculto, diário dentro e fora dos 30 dias, e um segundo paciente arquivado:
  - cada contagem = tamanho do que a função do portal devolve **na sessão de paciente com login** (`feedDeConteudos`, `documentosDoPaciente`, `planoDoPaciente` — receitas com `disponivel` —, `evolucaoParaPaciente`, `meusEnvios`, `jornadaDoPaciente`, `diarioDoPaciente` filtrado a 30 dias), com o cenário abaixo dos limites das listas;
  - `visiveis` item a item = os ids que a função do portal devolve;
  - arquivado: `contagens` nulo e `visiveis` vazio; estado `arquivado`;
  - `sem trilha`: nenhum `audit_log` novo;
  - `papel`: ctx `paciente` → erro;
  - `cobertura`: toda seção de `SECOES_DA_FICHA` com `noApp` aparece no cenário (o teste falha se um plano registrar `noApp` sem o caso).
  `no-app-fonte.test.ts`: `no-app.ts` não exporta o helper do `semConta`; não importa `auditRead` nem `liberarReceitasDoPlano`; não cita `patientCadastro`; só `no-app.ts` cria `TxDePaciente` (*cast* `as TxDePaciente` em nenhum outro arquivo). `page.test.ts`: textos da §8.5 (convite pendente, sem convite com o link "Reenviar o convite no Perfil", arquivado, bloqueado, nunca acessou, sem push, % de gordura nos dois estados, IA Nutri, documentos desligados).
- [ ] **Step 2:** `pnpm vitest run src/modules/ficha/no-app "src/app/painel/pacientes/[id]/app" src/db/sem-conta-guarda.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm vitest run src/modules/ficha src/modules/portal/conteudos.test.ts` + `pnpm typecheck && pnpm lint` → PASS (a guarda da liberação das receitas continua com os mesmos chamadores).
- [ ] **Step 5:** commit `feat(ficha): No app do paciente (P18-09)`.

**Pronto quando:** CS-261 verde no teste de paridade, `semConta` só em `no-app.ts` (além dos de antes) e o selo vem do contexto de paciente. Revisão: `revisor-rls` (obrigatória: `semConta`, `TxDePaciente`, paridade) e `revisor-interface` (cartão e página).

---

### Task 10: LGPD — exportação, PDF e anonimização

**Esperar o merge do Plano 17** (ou fazer rebase nele): disputa `lgpd.ts`, `exportacao-job.ts`, `exportacao.test.ts`, `lgpd.test.ts`.

**Files:**
- Modify: `src/modules/pacientes/exportacao-job.ts` (`montarDados`: `paciente.cadastro` nos dois escopos, por inclusão explícita, com `cpf` e `telefoneFixo` formatados e `identidadeDeGenero`, `estadoCivil`, `escolaridade` pelos **rótulos** da tela; `cadastro: null` sem linha; comentário atualizado; LEIA-ME cita o bloco), `src/modules/pacientes/prontuario-pdf.tsx` (seção "Identificação": nome civil, "Nome social: …" logo depois, gênero, estado civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço, celular e fixo; sem CPF e sem observação), `src/modules/pacientes/lgpd.ts` (`anonimizarVencidos`: dentro de `if (r.length)`, `delete from patient_cadastro where patient_id = …`; no fim da varredura, a rede `delete from patient_cadastro c using patients p where p.tenant_id = c.tenant_id and p.id = c.patient_id and p.anonimizado_em is not null`, contexto `worker`, com comentário citando a janela do deploy e a volta atrás)
- Create: `src/modules/pacientes/colunas-decididas.test.ts` (cobertura de colunas)
- Test: `src/modules/pacientes/exportacao.test.ts` (literais de `DadosExportacao` atualizados), `src/modules/pacientes/lgpd.test.ts`

- [ ] **Step 1: Testes que falham:** `exportacao.test.ts`: `dados.json` dos dois escopos traz `paciente.cadastro` com CPF formatado e os rótulos; sem linha → `null`; **Review Focus 5** o texto do `prontuario.pdf` (extraído) tem o nome civil antes de "Nome social:" e não tem o CPF nem a observação. `lgpd.test.ts`: anonimização apaga a linha e grava o "excluir" de ator nulo no `audit_log`; bloqueio (exclusão atendida) não muda o cadastro; `rede` — linha de titular já anonimizado (inserida antes de anonimizar por um caminho que não apaga, simulando a imagem antiga) some na varredura seguinte. `colunas-decididas.test.ts`: lê `information_schema.columns` de `patients` e `patient_cadastro` e falha se aparecer coluna fora do mapa `{ coluna: { exportacao, anonimizacao, ia } }` (com `lembretes_pausados_em` do Plano 17 se ele já estiver na `main`).
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/modules/pacientes/colunas-decididas.test.ts` → FAIL.
- [ ] **Step 3:** implementar (PDF só no worker; nenhuma rota importa `exportacao-job.ts`, regra 9).
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(lgpd): cadastro na exportação, no PDF e na anonimização (P18-10)`.

**Pronto quando:** o titular recebe o cadastro na cópia, o PDF leva a identificação da Res. 594 na ordem certa, e nenhuma linha de titular anonimizado sobra. Revisão: `revisor-rls` e `normas-cfn-lgpd`.

---

### Task 11: IA — nome social na máscara e guardas

Coordenar com o Plano 19 (mexe nos mesmos arquivos de `src/modules/ia/`): quem entra depois junta as duas mudanças.

**Files:**
- Create: `src/modules/ia/nome-social.ts` — `nomeSocialParaMascara(db: Db, tenantId: string, patientId: string): Promise<string | null>` (contexto `worker`, projeção `{ nomeSocial: patientCadastro.nomeSocial }`) e `nomeSocialNaTransacao(tx: Tx, patientId: string)` (mesma projeção, para quem já está numa transação `nutri` ou `worker`)
- Modify: `src/modules/ia/resumo-dados.ts` e `src/modules/ia/rascunho-dados.ts` (alvo com `outrosNomes: [nomeSocial]` quando houver), `src/modules/ia/nutri-paciente/contexto.ts` (o nome social lido por `nomeSocialParaMascara` **fora** da transação `semConta` e somado a `outrosNomes`; a leitura de laudo fica como está, sem máscara)
- Test: `src/modules/ia/nome-social-fonte.test.ts` (guarda), `src/modules/ia/campos-enviados.test.ts` (`proibidos` com os marcadores dos campos novos; fixture preenchendo **todos** os campos novos), `src/modules/ia/nutri-paciente/contexto.test.ts`, `src/modules/ia/pseudonimizar.test.ts` (nome social some do texto livre)

- [ ] **Step 1: Testes que falham:** guarda de fonte — em `src/modules/ia/**` (fora de testes), toda menção a `patientCadastro` está na projeção `{ nomeSocial: patientCadastro.nomeSocial }` (regex sobre o arquivo sem comentários; falha com `select().from(patientCadastro)`, join sem projeção ou outra coluna); `campos-enviados.test.ts`: resumo, rascunho e contexto da IA Nutri com todos os campos novos preenchidos não contêm CPF, CEP, rua, telefone fixo, observação, ocupação, estado civil nem o nome social; **Review Focus 1** `contexto.test.ts`: com nome social, o texto livre que o cita sai mascarado, e a leitura do nome social não roda no `withTenant` de paciente (espiar os contextos abertos).
- [ ] **Step 2:** `pnpm vitest run src/modules/ia/nome-social-fonte.test.ts src/modules/ia/campos-enviados.test.ts src/modules/ia/nutri-paciente/contexto.test.ts src/modules/ia/pseudonimizar.test.ts` → FAIL.
- [ ] **Step 3:** implementar; pedir ao `normas-cfn-lgpd` a confirmação de que a máscara com um nome a mais do próprio paciente não pede versão nova da autorização (RN-109, comentário de `pseudonimizar.ts`) e registrar a resposta no comentário de `pseudonimizar.ts`.
- [ ] **Step 4:** `pnpm vitest run src/modules/ia` → PASS.
- [ ] **Step 5:** commit `feat(ia): nome social na máscara (P18-11)`.

**Pronto quando:** só o nome social sai de `patient_cadastro` para a IA, e só para mascarar. Revisão: `normas-cfn-lgpd` (RN-109) e `revisor-rls`.

---

### Task 12: Fechamento — E2E, axe, carga, manuais e ajuda

**Files:**
- Create: `e2e/cadastro.spec.ts` (bloco de IP novo, comentado no cabeçalho)
- Modify: os seletores que o formulário novo quebra (spec RNF-263 g): `getByLabel('Telefone (opcional)')` → `getByLabel('Celular / WhatsApp (opcional)')` em `agenda.spec.ts:72` e `:324`, `pacientes.spec.ts:27`; `getByLabel('Nome')` → `getByLabel('Nome completo', { exact: true })` no helper `e2e/portal.ts:21`, `pacientes.spec.ts:23` e `:36`, `ia-modelos.spec.ts:46`, `plano-alimentar.spec.ts:155`, `:236`, `:533` e `:570`, `acessibilidade.spec.ts:534`, `agenda.spec.ts:67` e `:320` (conferir cada linha: os de alimento e da página pública continuam "Nome"); `e2e/painel-rotas.ts` (rota `app`), `e2e/acessibilidade-painel.spec.ts`; `scripts/e2e-seed.ts` (paciente com nome social e cadastro completo; outro incompleto); `test/carga/cenario.js` e `test/carga/seed.ts` (cenário "abrir a ficha": Início com as seções e o cartão "No app")
- Modify: `docs/manual-tecnico/02-banco-de-dados.md` (§2.5.1 matriz, §2.5.4 `patient_cadastro`), `04-modulos-clinicos.md` (§4.2.1 cadastro, Início, lista, §4.2.8 anonimização, §4.2.9 exportação), `05-agenda-portal-conteudo.md` (§5.8.1: guias `inicio-paciente`, `perfil-paciente`, `pacientes` v2, `prontuario` v3, e a contagem de guias), `06-worker-seguranca-operacao.md` (§6.8.1: a rede da anonimização na volta atrás), `03-autenticacao-e-acesso.md` (o `semConta` do `no-app.ts`), `README.md` (glossário: Início, Perfil, "No app", `TxDePaciente`; divergências spec × código, se houver) — pelo `guardiao-manual`
- Modify: `CLAUDE.md` regras 2 e 8 (frase nova com o Plano 18: `patient_cadastro` com a política sem conta, os gatilhos, `SEM_DELETE`/`IMUTAVEIS`, auditoria como `patients`, pré-checagem do CPF); spec §16 marcada; backlog (PD-10 a PD-13 e os Minor que sobrarem)
- Preparar para o dono (sem publicar): texto do manual do usuário (Docs) e da Central de Ajuda (artigos de cadastro, lista, Início e "No app")

- [ ] **Step 1: E2E que falha** (`e2e/cadastro.spec.ts`): cadastro com CPF, estado civil e CEP (US-260) → Perfil mostra; CPF repetido → mensagem e o link em nova aba, o digitado continua; lista: abas, ordem `recentes` mantendo a busca, arquivar pela lista (confirmação aceita por `page.on('dialog')`, "Paciente arquivado." na região e foco no título), `?status=arquivado` abre Inativos; Início com a nota "Cadastro incompleto" e o selo "No app"; página "No app" com as contagens do paciente da semente; impressão (`emulateMedia({ media: 'print' })`) com o nome civil antes de "Nome social". Axe (RNF-261) no Início, Perfil, lista e `[id]/app`, a 1280 e 360 px, claro e escuro, mais o menu da linha aberto e o diálogo Adicionar aberto.
- [ ] **Step 2:** `APP_URL=http://localhost:3101 pnpm test:e2e e2e/cadastro.spec.ts e2e/ficha.spec.ts e2e/acessibilidade-painel.spec.ts` → FAIL.
- [ ] **Step 3:** ajustes que o E2E pedir; seletores dos outros specs; manual técnico pelo `guardiao-manual`; carga com o cenário "abrir a ficha" (p95 ≤ 800 ms, CS-263) na pilha local (P08-03), resultado registrado no PR; avisar a orquestradora (para as sessões dos Planos 19 e 20) da troca do rótulo "Nome" e do helper `e2e/portal.ts`.
- [ ] **Step 4:** `APP_URL=http://localhost:3101 pnpm test:e2e && pnpm test && pnpm lint && pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 18 (P18-12)`.

**Pronto quando:** os critérios do §16 da spec estão marcados, o E2E inteiro passa na porta da sessão, e manual técnico, CLAUDE.md, manual do usuário e Central de Ajuda estão atualizados ou prontos para o dono. Revisão: `guardiao-manual` e `revisor-interface`.

---

## Ordem e paralelismo

```
PR 1:  T1 ──► (T2 ‖ T3) ──► T4 ──► revisão do PR 1 ──► merge (OK do dono)
PR 2:  T5 ──► T6 ──► (T7 ‖ T8) ──► T9 ──► (T10* ‖ T11) ──► T12 ──► migration regenerada ──► revisão do PR 2 ──► merge (OK do dono)
       * T10 depois do merge do Plano 17 (ou com rebase nele)
```

T2 e T3 mexem em arquivos diferentes (abas/Perfil × layout/cabeçalho), salvo `layout.tsx` (T3) e o `Abas` que ele chama (T2): integrar T2 antes de T3 se houver conflito. T7 e T8 dividem `actions.ts`, `valores.ts` e o guia `pacientes`: T7 só acrescenta o passo `cadastro-paciente`, e a versão do guia sobe uma vez, na T8. Nunca dois implementadores no mesmo worktree (`sessoes-paralelas.md` §1): o paralelismo é de subagentes em worktrees temporários integrados por cherry-pick no branch, como nos Planos 06–16.

## Depois das tarefas (fluxo do CLAUDE.md)

Vale para **cada PR** (o PR 1 depois da Tarefa 4; o PR 2 depois da Tarefa 12), uma revisão pesada por vez entre as sessões (`sessoes-paralelas.md` §7):

Revisão final do branch (workflow, com `revisor-rls` — política sem conta, `semConta` do `no-app.ts`, `TxDePaciente`, gatilhos, listas do isolamento, auditoria do cabeçalho e do Perfil —, `normas-cfn-lgpd` — ordem dos nomes na impressão e no PDF, base legal, CPF, exportação, anonimização, máscara da IA e RN-109 —, `revisor-interface` — abas, diálogo, `<details>`, menu, região viva, formulário, textos exatos, guias —, `guardiao-manual` — manual técnico, CLAUDE.md, ajuda) → uma onda de correções → `/code-review high` no PR uma vez → correções Critical/Important (Minor no backlog) → re-revisão do diff das correções → `/security-review` (checklist reforçado: RLS e isolamento por paciente, `semConta`, LGPD, dados no log) → rebase na `main` atual (no PR 2, com a migration regenerada pela seção "Migration") e CI verde → merge **só com o OK do dono** (merge = deploy; no PR 2 a migration roda no boot; sem merge das 03h às 07h30 BRT). A sessão avisa a orquestradora a cada etapa (início, PR aberto, CI verde, revisão, pronto para merge) para o painel da onda.
