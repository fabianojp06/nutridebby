# Plano 17 — Lembretes de rotina no app do paciente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista configura, por paciente, lembretes por push (água, refeições do plano com pedido de registro no diário, suplemento e lembrete livre), e o worker os envia no minuto certo.

**Architecture:** configuração em `lembretes_rotina` (RLS de tenant + paciente, auditada) e a marca do último envio em `lembretes_rotina_envios` (fora da auditoria). Um módulo puro calcula o plano do dia (slots, fusão por minuto, teto de 24). Um job `lembretes-rotina` a cada minuto envia por push, reusando o envio aos dispositivos do motor atual, sem gravar em `notifications`.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas/actions) · Drizzle · PostgreSQL 16 (RLS) · pg-boss · web-push · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-nutridebby-lembretes-de-rotina-design.md` (aprovada pelo dono em 13/11/2026).

## Global Constraints

- Só push. Nada de WhatsApp, e-mail ou linha em `notifications` para lembretes de rotina.
- Janela permitida: **06:00 a 22:00** no fuso do tenant (`tenants.fuso`); início ≥ 06:00, fim ≤ 22:00, slot às 22:00 vale.
- Teto: **24 pushes por paciente por dia**; avisos fundidos no mesmo minuto contam 1.
- Prioridade (fusão e corte): `refeicao` > `suplemento` > `livre` > `diario` > `agua`.
- Tolerância: slot com mais de **10 min** de atraso é pulado. TTL do push: **1800 s**. No máximo uma vez por slot (marca gravada antes do envio).
- Intervalos da água: 60, 90, 120, 180, 240 min. Antecedência da refeição: 0, 15, 30 min. Diário depois: 30 ou 60 min (ou desligado). Horários de suplemento/livre: 1 a 4. Até 5 suplementos e 5 livres por paciente. Nome do suplemento ≤ 60, texto livre ≤ 120.
- Título do push: `'NutriDebby'`. Textos da tela de bloqueio (exatos):
  - água: `Hora de beber água 💧`
  - refeição: `Está chegando a hora: {nome da refeição}` (antecedência > 0) / `Hora de: {nome da refeição}` (antecedência 0)
  - diário: `Registre sua refeição no diário`
  - suplemento: `Hora do seu suplemento`
  - livre: `Você tem um lembrete do seu plano`
- Nome do suplemento e texto livre **nunca** no payload do push nem em log (CLAUDE.md regra 3).
- Sem lembrete de pesagem, contagem, sequência ou medalha. Texto do sistema é "Aviso do app"; só o que a nutricionista escreveu leva "Sua nutricionista: …" (C-197).
- Regras 1, 2, 8 e 9 do `CLAUDE.md` (withTenant, RLS + guardas, auditoria, `FABRICAS`). Migrations com `DATABASE_URL_MIGRATOR`.
- Textos de interface em pt-BR. Rotas do portal mantêm `?v=` do vínculo (`telaDoPortal`).

## Review Focus

1. **Fuso e virada do dia** — tenant em `America/Manaus` ou `America/Noronha`: os slots saem na hora local, e o "dia" usado no teto e no "já registrou no diário" é o do tenant, não UTC. Teste em `slots.test.ts` (Tarefa 2).
2. **Plano republicado ou arquivado no meio do dia** — sem plano publicado nenhum slot de refeição/diário sai; refeição com horário mudado não reenvia um slot já enviado no mesmo dia. Teste em `envio.test.ts` (Tarefa 4).
3. **Paciente com dois consultórios** — os lembretes e as inscrições de push de um vínculo nunca saem pelo outro. Teste em `envio.test.ts` (Tarefa 4).
4. **Worker parado e de volta** — depois de 30 min parado, nada atrasado sai; só o slot do minuto corrente (≤ 10 min). Teste em `envio.test.ts` (Tarefa 4).
5. **Paciente desligou, nutricionista edita** — editar o lembrete não limpa `desligado_pelo_paciente_em`. Teste em `equipe.test.ts` (Tarefa 3).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/db/schema/lembretes.ts` | Tabelas `lembretes_rotina` e `lembretes_rotina_envios` |
| `src/db/schema/pacientes.ts` (modificar) | Coluna `lembretes_pausados_em` |
| `drizzle/0118_lembretes_rotina.sql` (gerada) + `drizzle/0119_rls_lembretes_rotina.sql` (custom) | Tabelas; RLS, auditoria, gatilhos, `paciente_colunas` |
| `src/modules/lembretes/constantes.ts` | Limites, prioridades, textos do push e da tela |
| `src/modules/lembretes/config.ts` | Tipos e validação da configuração |
| `src/modules/lembretes/slots.ts` | Cálculo puro do plano do dia |
| `src/modules/lembretes/equipe.ts` | Leitura e escrita pela equipe |
| `src/modules/lembretes/paciente.ts` | Leitura e escrita pelo paciente |
| `src/modules/lembretes/envio.ts` | Job do worker |
| `src/modules/notificacoes/push-dispositivos.ts` | Envio a todas as inscrições de um paciente (extraído de `enviar.ts`) |
| `src/app/painel/pacientes/[id]/plano-alimentar/lembretes/*` | Seção do painel |
| `src/app/p/(portal)/perfil/lembretes/*` | Página Eu › Lembretes |

---

### Task 1: Banco — tabelas, RLS, auditoria e guardas

**Files:**
- Create: `src/db/schema/lembretes.ts`; export em `src/db/schema/index.ts`
- Modify: `src/db/schema/pacientes.ts` (coluna `lembretesPausadosEm: timestamp('lembretes_pausados_em', { withTimezone: true })`)
- Create: `drizzle/0118_lembretes_rotina.sql` (`pnpm db:generate`), `drizzle/0119_rls_lembretes_rotina.sql` (`pnpm drizzle-kit generate --custom --name rls_lembretes_rotina`)
- Modify: `src/db/rls-guard.ts` (`STAFF_ONLY`, `PACIENTE_ESCREVE`), `src/db/audit-guard.ts` (`AUDIT_EXCEPTIONS`), `test/isolamento.test.ts` (`FABRICAS`, `COM_MAE`, filtro de `SO_APAGA.patients` se preciso)
- Test: `src/modules/lembretes/banco.test.ts`

**Interfaces:**
- Produces: `lembretesRotina`, `lembretesRotinaEnvios`, `LembreteRotinaRow`, `patients.lembretesPausadosEm`.

Tabela `lembretes_rotina`: `id uuid pk`, `tenant_id`, `patient_id` (FK composta para `patients`), `tipo text` CHECK `in ('agua','refeicoes','suplemento','livre')`, `config jsonb not null`, `texto text` (CHECK: `suplemento` → 1..60; `livre` → 1..120; `agua`/`refeicoes` → nulo), `ligado boolean not null default true`, `desligado_pelo_paciente_em timestamptz`, `criado_por uuid not null`, `created_at`, `updated_at`; índice único parcial `(tenant_id, patient_id, tipo) where tipo in ('agua','refeicoes')`; `unique (tenant_id, patient_id, id)`.
Tabela `lembretes_rotina_envios`: `lembrete_id uuid pk`, `tenant_id`, `patient_id`, `ultimo_slot_em timestamptz not null`, `updated_at`; FK `(tenant_id, patient_id, lembrete_id)` → `lembretes_rotina` `ON DELETE CASCADE`.

Migration 0119 (molde da 0116):
- `app_enable_tenant_rls` + `app_enable_patient_rls` nas duas; `app_enable_audit('lembretes_rotina', 'lembretes')`; `app_enable_staff_only('lembretes_rotina_envios')`.
- `app_allow_paciente_escrita('lembretes_rotina', 'update')` + gatilho `lembretes_rotina_regras` (BEFORE UPDATE): sessão `paciente` só muda `desligado_pelo_paciente_em` e `updated_at`; colunas `id, tenant_id, patient_id, tipo, criado_por, created_at` fixas para todos; `publico`/`conta` nada.
- Gatilho `lembretes_rotina_envios_do_worker`: INSERT/UPDATE só com `app_current_role() = 'worker'` (contexto vazio passa).
- `CREATE OR REPLACE FUNCTION` da função de `paciente_colunas` (0085) com `'lembretes_pausados_em'` acrescentado a `livres`; o resto copiado linha a linha.
- `AUDIT_EXCEPTIONS.lembretes_rotina_envios`: `'registro técnico de envio (último horário enviado); nenhum dado clínico — a configuração fica em lembretes_rotina, que é auditada'`.

- [ ] **Step 1: Escrever os testes que falham** em `banco.test.ts`:
  - `paciente só desliga o próprio lembrete` — sessão de paciente: UPDATE de `desligado_pelo_paciente_em` passa; UPDATE de `config`, `ligado` ou `texto` → erro `42501`.
  - `paciente pausa os próprios lembretes` — UPDATE de `patients.lembretes_pausados_em` pela sessão de paciente passa.
  - `marca de envio só pelo worker` — INSERT em `lembretes_rotina_envios` com papel `nutri` → `42501`; com `worker` passa.
  - `escrita da equipe vira audit_log` — INSERT pela sessão `nutri` grava `audit_log` com entidade `lembretes`; UPDATE da marca pelo worker não grava.
  - `CHECK do texto por tipo` — `agua` com texto, ou `suplemento` sem texto → violação de CHECK.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/banco.test.ts` → FAIL (tabelas não existem).
- [ ] **Step 3:** schema, `pnpm db:generate`, migration custom, `pnpm db:migrate`.
- [ ] **Step 4:** `pnpm vitest run src/modules/lembretes/banco.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts` → PASS.
- [ ] **Step 5:** commit `feat(lembretes): tabelas, RLS e auditoria dos lembretes de rotina (P17-01)`.

---

### Task 2: Regras puras — configuração e plano do dia

**Files:**
- Create: `src/modules/lembretes/constantes.ts`, `src/modules/lembretes/config.ts`, `src/modules/lembretes/slots.ts`
- Test: `src/modules/lembretes/config.test.ts`, `src/modules/lembretes/slots.test.ts`

**Interfaces:**
- Produces:
```ts
// config.ts
export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo
export type ConfigAgua = { inicio: string; fim: string; intervaloMin: 60 | 90 | 120 | 180 | 240; dias: DiaDaSemana[] };
export type ConfigRefeicoes = { antecedenciaMin: 0 | 15 | 30; diarioDepoisMin: 30 | 60 | null };
export type ConfigHorarios = { horarios: string[]; dias: DiaDaSemana[] }; // suplemento e livre
export type LembreteNovo =
  | { tipo: 'agua'; config: ConfigAgua } | { tipo: 'refeicoes'; config: ConfigRefeicoes }
  | { tipo: 'suplemento'; config: ConfigHorarios; texto: string } | { tipo: 'livre'; config: ConfigHorarios; texto: string };
export function validarLembrete(input: unknown): { ok: true; valor: LembreteNovo } | { ok: false; erros: Record<string, string> };
export function sugestaoInicial(): LembreteNovo[]; // água 08:00–20:00 / 120 / todos os dias; refeições 0 / null
// slots.ts
export type TipoSlot = 'refeicao' | 'diario' | 'suplemento' | 'livre' | 'agua';
export type LembreteParaSlots = { id: string; ativo: boolean } & LembreteNovo;
export type RefeicaoDoPlano = { nome: string; horario: string | null }; // 'HH:MM' ou null
export type Slot = { em: Date; tipo: TipoSlot; lembreteIds: string[]; refeicao: string | null };
export function planoDoDia(e: { lembretes: LembreteParaSlots[]; refeicoes: RefeicaoDoPlano[]; data: string /* AAAA-MM-DD no fuso */; fuso: string }):
  { slots: Slot[]; cortados: number; refeicoesSemHorario: string[]; refeicoesForaDaJanela: string[] };
export function maiorDiaDaSemana(e: Omit<Parameters<typeof planoDoDia>[0], 'data'>): number; // maior total entre os 7 dias da semana
```
`planoDoDia`: gera os slots de cada lembrete `ativo` no dia (água: de `inicio` a `fim` de `intervaloMin` em `intervaloMin`; refeição: `horario − antecedenciaMin`; diário: `horario + diarioDepoisMin`; suplemento/livre: cada horário), descarta os fora da janela 06:00–22:00, funde os do mesmo minuto num só (tipo de maior prioridade, `lembreteIds` unidos) e, acima de 24, corta pelos de menor prioridade (`cortados` = quantos saíram). Ordenado por `em`.

- [ ] **Step 1: Testes que falham.** `config.test.ts`: aceita a sugestão inicial; recusa `inicio` 05:30 (`{ inicio: 'Escolha um horário entre 06:00 e 22:00.' }`), `intervaloMin` 45, 5 horários, texto de suplemento com 61 caracteres, `dias` vazio. `slots.test.ts`:
  - `água 08–20 a cada 2h dá 7 slots` (08,10,…,20).
  - `refeição 30 min antes e diário 60 min depois` — Almoço 12:00 → slots 11:30 (`refeicao`) e 13:00 (`diario`).
  - `refeição sem horário não gera slot` e aparece em `refeicoesSemHorario`; `Ceia 22:30` em `refeicoesForaDaJanela`.
  - `mesmo minuto vira um push` — água 12:00 + Almoço 12:00 → 1 slot `refeicao` com os dois ids.
  - `teto 24 corta água primeiro` — água a cada 60 min 06–22 (17) + 6 refeições com diário (12) → 24 slots, `cortados` 5, nenhum `refeicao` cortado.
  - `fuso` (Review Focus 1) — `America/Manaus`, água 08:00 em `2026-11-16` → `em` = `2026-11-16T12:00:00Z`.
  - `dia da semana` — suplemento só seg–sex não gera slot num sábado.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/config.test.ts src/modules/lembretes/slots.test.ts` → FAIL.
- [ ] **Step 3:** implementar (datas no fuso com o helper já usado em `src/modules/agenda/fuso.ts`).
- [ ] **Step 4:** mesmos testes → PASS.
- [ ] **Step 5:** commit `feat(lembretes): validação e plano do dia (P17-02)`.

---

### Task 3: Módulo da equipe

**Files:**
- Create: `src/modules/lembretes/equipe.ts`
- Test: `src/modules/lembretes/equipe.test.ts`

**Interfaces:**
- Consumes: Tarefa 1 (tabelas), Tarefa 2 (`validarLembrete`, `planoDoDia`, `maiorDiaDaSemana`, `sugestaoInicial`).
- Produces:
```ts
export type LembreteNaEquipe = LembreteNovo & { id: string; ligado: boolean; desligadoPeloPacienteEm: Date | null };
export type VisaoDaEquipe = {
  lembretes: LembreteNaEquipe[]; sugestao: LembreteNovo[] | null; // sugestão só quando o paciente não tem nenhum
  previstoHoje: number; cortadosHoje: number; refeicoesSemHorario: string[]; refeicoesForaDaJanela: string[];
  aparelhosComNotificacao: number; pausadoEm: Date | null;
};
export async function lembretesDoPaciente(ctx: TenantContext, patientId: string, tenant: { fuso: string }, deps?: { db?: Db; agora?: Date }): Promise<VisaoDaEquipe>;
export async function salvarLembrete(ctx: TenantContext, patientId: string, input: unknown, tenant: { fuso: string }, deps?: { db?: Db }): Promise<{ id: string }>; // input com `id` opcional = edição
export async function ligarLembrete(ctx: TenantContext, patientId: string, id: string, ligado: boolean, deps?: { db?: Db }): Promise<void>;
export async function apagarLembrete(ctx: TenantContext, patientId: string, id: string, deps?: { db?: Db }): Promise<void>;
export class LembreteError extends Error { constructor(public erros: Record<string, string>) }
```
- `lembretesDoPaciente` lê pela sessão `nutri` (withTenant) e chama `auditRead(tx, …)` com entidade `lembretes` quando há lembretes, como a leitura do plano no painel (`src/modules/plano-alimentar/carregar.ts`).
- `salvarLembrete` trava o paciente, recusa paciente bloqueado/anonimizado, aplica os limites (5 suplementos, 5 livres) e recusa se `maiorDiaDaSemana` > 24 com a mensagem `Com este lembrete, o paciente receberia mais de 24 avisos em um dia. Diminua os horários ou aumente o intervalo da água.`. Na edição mantém `desligado_pelo_paciente_em`.

- [ ] **Step 1: Testes que falham:** salva e lê a sugestão; `segunda água → erro` (índice único vira `LembreteError`); `6º suplemento → erro`; `acima de 24 → erro` com o texto exato; **Review Focus 5** `editar não religa o que o paciente desligou`; `outro tenant não vê` (RLS); `aparelhosComNotificacao` conta só as inscrições do vínculo.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/equipe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(lembretes): configuração pela equipe (P17-03)`.

---

### Task 4: Worker — job `lembretes-rotina`

**Files:**
- Create: `src/modules/notificacoes/push-dispositivos.ts`, `src/modules/lembretes/envio.ts`
- Modify: `src/modules/notificacoes/enviar.ts` (`enviarPush` passa a usar `enviarAoPaciente`), `src/jobs/queues.ts` (`'lembretes-rotina': { retryLimit: 0, expireInSeconds: 120, deleteAfterSeconds: 3_600 }`), `src/worker/index.ts` (schedule `'* * * * *'`, tz `America/Sao_Paulo`)
- Test: `src/modules/lembretes/envio.test.ts`; `src/modules/notificacoes/enviar.test.ts` continua verde sem mudança

**Interfaces:**
- Consumes: Tarefa 2 (`planoDoDia`), Tarefa 1 (tabelas), `ProvedorPush` (`push.ts`), `listarTenantsParaVarredura`/`buscarTenant`, `rotuloDaRefeicao`/`refeicaoDoDiario` (`src/modules/portal/diario-constantes.ts`), `telaDoPortal` (`src/modules/portal/link-portal.ts`), `urlDoApp` (`src/lib/url-do-app.ts`).
- Produces:
```ts
// push-dispositivos.ts — o laço de enviarPush (inscrições do paciente, remoção das mortas, classificação), sem ContextoEnvio
export type ResultadoAoPaciente = 'enviada' | 'sem_inscricao' | 'incerta' | 'passageira' | 'definitiva';
export async function enviarAoPaciente(a: { db: Db; tenantId: string; patientId: string; push: ProvedorPush; payload: string; ttlS: number; logCtx: Record<string, string> }): Promise<{ resultado: ResultadoAoPaciente; codigo: string | null }>;
// envio.ts
export type DepsLembretes = { db: Db; agora: () => Date; appUrl: string; push: ProvedorPush | null };
export const CONCORRENCIA_ENVIO = 10;
export async function processarLembretes(deps: DepsLembretes): Promise<{ enviados: number; pulados: number; falhas: number }>;
```
Fluxo por tenant `ativa` (contexto `worker`): pacientes `ativo`, sem `anonimizado_em`, com `user_id`, sem `lembretes_pausados_em`, com lembrete `ligado` e sem `desligado_pelo_paciente_em`; refeições do plano `publicado`; `planoDoDia` do dia local; escolhe, por paciente, o slot mais recente com `agora − 10 min < em ≤ agora` e `em >` `ultimo_slot_em` de todos os seus `lembreteIds`; slot `diario` é pulado se o diário já tem registro daquela refeição no dia (mesmo critério de `refeicaoDoPlano`/`refeicao` do `registrarNoDiario`); grava/atualiza a marca (`ultimo_slot_em = em`) dos `lembreteIds` **na transação**, e só depois envia, fora dela, em lotes de `CONCORRENCIA_ENVIO`. Push desligado (`deps.push` nulo) → não marca nem envia. Log técnico só com contagens e `tenantId`.
Payload: `{ titulo: 'NutriDebby', corpo, url }`; `url` = `/p/plano` (refeição), `/p/diario` (diário), `/p/perfil/lembretes` (suplemento, livre), `/p/inicio` (água), sempre por `telaDoPortal(…, tenantId)`.

- [ ] **Step 1: Testes que falham** (`ProvedorPush` falso que registra os payloads, `agora` controlado):
  - `envia a água das 10:00 às 10:00:30` e `não reenvia às 10:01`.
  - **Review Focus 4** `parado 30 min não envia atrasado` — `agora` 10:31 com slots 10:00 e 10:30 pendentes → só o das 10:30.
  - `sem plano publicado não há refeição` e **Review Focus 2** `plano republicado com Almoço de 12:00 para 12:05 depois do envio das 12:00 envia o das 12:05, não repete o das 12:00`.
  - `diário já registrado não pede registro`.
  - `paciente pausado, lembrete desligado pelo paciente, paciente arquivado, tenant suspenso → nada`.
  - **Review Focus 3** `paciente em dois consultórios` — o push do tenant A só vai às inscrições do vínculo A.
  - `payload de suplemento não contém o nome` — `JSON.stringify(payload)` não contém o texto do suplemento.
  - `inscrição 410 é apagada` (via `enviarAoPaciente`).
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/envio.test.ts` → FAIL.
- [ ] **Step 3:** extrair `enviarAoPaciente` (comportamento idêntico; `enviarPush` mapeia o resultado para `Resultado`), implementar `processarLembretes`, registrar fila e cron.
- [ ] **Step 4:** `pnpm vitest run src/modules/lembretes/envio.test.ts src/modules/notificacoes/` → PASS.
- [ ] **Step 5:** commit `feat(lembretes): envio por push no worker (P17-04)`.

---

### Task 5: Painel — seção "Lembretes no app" na aba Plano alimentar

**Files:**
- Create: `src/app/painel/pacientes/[id]/plano-alimentar/lembretes/secao.tsx`, `.../lembretes/form-lembrete.tsx` (client), `.../lembretes/actions.ts`
- Modify: `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx` (renderiza a seção abaixo da lista de planos), guia da tela do prontuário (manual guiado, `data-guia="lembretes-app"`)
- Test: `.../lembretes/actions.test.ts`

**Interfaces:**
- Consumes: Tarefa 3 (`lembretesDoPaciente`, `salvarLembrete`, `ligarLembrete`, `apagarLembrete`, `LembreteError`).
- Produces: `salvarLembreteAction(patientId, prev, formData)`, `ligarLembreteAction(patientId, id, ligado)`, `apagarLembreteAction(patientId, id)` (server actions, `revalidatePath` da aba).

Textos exatos:
- Título `Lembretes no app`; situação `Notificações: ativas em {n} aparelho(s)` / `Este paciente ainda não ativou as notificações no app. Os lembretes começam quando ele ativar.`
- `Previsto para hoje: {n} lembretes`; com corte: `Acima do limite de 24 por dia: alguns lembretes de água não serão enviados.`
- Refeição sem horário: `{nome} sem horário — não gera lembrete`; fora da janela: `{nome} fora do horário dos lembretes (6h às 22h)`.
- Desligado pelo paciente: `Desligado pelo paciente em {data}`; pausa geral: `O paciente pausou todos os lembretes em {data}.`
- Botões: `Adicionar suplemento`, `Adicionar lembrete livre`, `Editar`, `Salvar`, `Apagar`; sugestão: `Sugestão — confira e salve`.
- Paciente bloqueado: seção só leitura (sem botões), como o resto da aba.

- [ ] **Step 1: Testes que falham** (`actions.test.ts`): a action devolve os erros de `LembreteError` por campo; sessão de outra usuária/tenant não salva; paciente bloqueado → erro.
- [ ] **Step 2:** `pnpm vitest run "src/app/painel/pacientes/[id]/plano-alimentar/lembretes"` → FAIL.
- [ ] **Step 3:** implementar a seção (componentes base V2, `min-h-11`, rótulos visíveis, erros ao lado do campo).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): lembretes no app na aba Plano alimentar (P17-05)`.

---

### Task 6: Portal — Eu › Lembretes

**Files:**
- Create: `src/modules/lembretes/paciente.ts`, `src/app/p/(portal)/perfil/lembretes/page.tsx`, `.../lembretes/actions.ts`, `.../lembretes/interruptor.tsx` (client)
- Modify: `src/app/p/(portal)/perfil/page.tsx` (item "Lembretes" na lista, só com algum lembrete), `src/app/p/(portal)/inicio/cartoes-do-aparelho.tsx` (texto do cartão com lembretes), guia do portal (`src/modules/ajuda/portal`)
- Test: `src/modules/lembretes/paciente.test.ts`, `.../perfil/lembretes/actions.test.ts`

**Interfaces:**
- Consumes: Tarefas 1–3.
- Produces:
```ts
export type LembreteDoPaciente = { id: string; tipo: LembreteNovo['tipo']; resumo: string; textoDaNutri: string | null; desligado: boolean };
export async function meusLembretes(ctx: TenantContext, deps?: { db?: Db }): Promise<{ lembretes: LembreteDoPaciente[]; pausadoEm: Date | null }>; // só ligados pela equipe
export async function desligarMeuLembrete(ctx: TenantContext, id: string, desligar: boolean, deps?: { db?: Db }): Promise<void>;
export async function pausarMeusLembretes(ctx: TenantContext, pausar: boolean, deps?: { db?: Db }): Promise<void>;
export function temLembretes(ctx: TenantContext, deps?: { db?: Db }): Promise<boolean>;
```
Textos exatos: título `Lembretes`; introdução `Sua nutricionista configurou estes lembretes. Você pode desligar qualquer um.`; `Pausar todos os lembretes` / `Retomar os lembretes`; aviso da pausa `Lembretes pausados. Você não vai receber avisos até retomar.`; detalhe do suplemento/livre `Sua nutricionista: {texto}`; resumo da água `Água: das {inicio} às {fim}, a cada {intervalo}`; sem push neste aparelho, o `AtivarNotificacoes` atual com `Ative as notificações para receber os lembretes da sua nutricionista.`; o cartão do Hoje usa o mesmo texto quando `temLembretes`.

- [ ] **Step 1: Testes que falham:** paciente lê só os próprios (RLS, outro paciente do mesmo tenant não aparece); desligado pela equipe (`ligado = false`) não aparece; `desligarMeuLembrete` grava a data e o religar a limpa; `pausarMeusLembretes` grava/limpa `lembretes_pausados_em`; a action recusa id de outro paciente.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/paciente.test.ts "src/app/p/(portal)/perfil/lembretes"` → FAIL.
- [ ] **Step 3:** implementar (molde visual de Eu, `font-portal-titulo`, `CARTAO`; interruptor com `role="switch"` e `aria-checked`).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(portal): Eu › Lembretes (P17-06)`.

---

### Task 7: LGPD — exportação e apagamento

**Files:**
- Modify: `src/modules/pacientes/exportacao-job.ts` (`montarDados`: chave `lembretes` com `{ tipo, config, texto, ligado, desligadoPeloPacienteEm, criadoEm }[]` e `lembretesPausadosEm`; sem a marca de envio), `src/modules/pacientes/lgpd.ts` (onde apaga `pushSubscriptions` na anonimização e na exclusão atendida, apagar também `lembretes_rotina` do paciente — a marca sai em cascata — e limpar `lembretes_pausados_em`)
- Test: `src/modules/pacientes/exportacao.test.ts`, `src/modules/pacientes/lgpd.test.ts` (casos novos)

- [ ] **Step 1: Testes que falham:** `dados.json traz os lembretes e não traz ultimo_slot_em`; `anonimização apaga os lembretes e as marcas`; `exclusão atendida apaga os lembretes`.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(lgpd): lembretes na exportação e no apagamento (P17-07)`.

---

### Task 8: Fechamento — E2E, manuais e ajuda

**Files:**
- Create: `e2e/lembretes.spec.ts`
- Modify: `scripts/e2e-seed.ts` (se precisar de plano publicado com horários), `docs/manual-tecnico/05-agenda-portal-conteudo.md` (§5.3 nova subseção "Lembretes de rotina"), `docs/manual-tecnico/02-banco-de-dados.md` (tabelas), `docs/manual-tecnico/README.md` (glossário e divergências, se houver)
- Test: o próprio E2E

- [ ] **Step 1: E2E que falha:** nutricionista abre a aba Plano alimentar → salva a sugestão → vê `Previsto para hoje`; paciente abre Eu › Lembretes → vê "Água" → desliga → a nutricionista vê `Desligado pelo paciente em …`. Axe sem violações nas duas telas, claro e escuro.
- [ ] **Step 2:** `pnpm test:e2e e2e/lembretes.spec.ts` → FAIL.
- [ ] **Step 3:** ajustes que o E2E pedir; manual técnico pelo agente `guardiao-manual`; correções do manual do usuário (Docs) e da Central de Ajuda preparadas para o dono.
- [ ] **Step 4:** `pnpm test:e2e e2e/lembretes.spec.ts && pnpm test && pnpm lint && pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 17 (P17-08)`.

---

## Depois das tarefas (fluxo do CLAUDE.md)

Revisão final do branch (workflow, com `revisor-rls`, `normas-cfn-lgpd` — confere o nome da refeição no push e o suplemento sem receita —, `revisor-interface`, `guardiao-manual`) → uma onda de correções → `/code-review high` no PR uma vez → correções Critical/Important → re-revisão do diff das correções → `/security-review` → merge **só com o OK do dono** (merge = deploy; a migration roda no boot).
