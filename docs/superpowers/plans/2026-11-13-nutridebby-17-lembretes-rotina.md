# Plano 17 — Lembretes de rotina no app do paciente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista configura, por paciente, lembretes por push (água, refeições do plano com pedido de registro no diário, suplemento e lembrete livre), e o worker os envia no minuto certo.

**Architecture:** configuração em `lembretes_rotina` (RLS de tenant + paciente, auditada) e a marca do último envio em `lembretes_rotina_envios` (fora da auditoria). Um módulo puro calcula o plano do dia (slots, fusão por minuto, teto de 24). Um job `lembretes-rotina` a cada minuto envia por push, reusando o envio aos dispositivos do motor atual, sem gravar em `notifications`.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas/actions) · Drizzle · PostgreSQL 16 (RLS) · pg-boss · web-push · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-nutridebby-lembretes-de-rotina-design.md` (aprovada pelo dono em 13/11/2026).

## Global Constraints

- Só push. Nada de WhatsApp, e-mail ou linha em `notifications` para lembretes de rotina.
- Janela permitida: **06:00 a 22:00** no fuso do tenant (`tenants.fuso`); início ≥ 06:00, fim ≤ 22:00, slot às 22:00 vale.
- Teto: **24 pushes por paciente por dia**; avisos fundidos no mesmo minuto contam 1. O teto vale para o plano do dia em vigor em cada execução (corte determinístico por prioridade); uma mudança de configuração ou de plano no meio do dia pode somar avisos já enviados com o plano novo — limite aceito, sem contador diário.
- Prioridade (fusão e corte): `refeicao` > `suplemento` > `livre` > `diario` > `agua`.
- Tolerância: slot com mais de **10 min** de atraso é pulado. TTL do push: **1800 s**. No máximo uma vez por slot (marca gravada com upsert condicional antes do envio, Tarefa 4).
- Intervalos da água: 60, 90, 120, 180, 240 min. Antecedência da refeição: 0, 15, 30 min. Diário depois: 30 ou 60 min (ou desligado). Horários de suplemento/livre: 1 a 4. Até 5 suplementos e 5 livres por paciente. Nome do suplemento ≤ 60, texto livre ≤ 120.
- Título do push: `'NutriDebby'`. Textos da tela de bloqueio (exatos):
  - água: `Hora de beber água 💧`
  - refeição: `Está chegando a hora: {rótulo}` (antecedência > 0) / `Hora de: {rótulo}` (antecedência 0), só quando `refeicaoDoDiario(nome) !== 'Outro'`; `{rótulo}` = `refeicaoDoDiario(nome)` (item de `REFEICOES_DO_DIARIO`), nunca o texto digitado nem `rotuloDaRefeicao` (que leva o horário). Fora da lista: `Está chegando a hora da sua refeição` / `Hora da sua refeição`.
  - diário: `Registre sua refeição no diário`
  - suplemento: `Hora do seu suplemento`
  - livre: `Você tem um lembrete do seu plano`
- Nome do suplemento, texto livre e nome da refeição fora da lista fechada **nunca** no payload do push nem em log (CLAUDE.md regra 3). O worker nem lê `lembretes_rotina.texto` (minimização, LGPD art. 6º, III).
- Sem lembrete de pesagem, contagem, sequência ou medalha. Texto do sistema é "Aviso do app"; só o que a nutricionista escreveu leva "Sua nutricionista: …" (C-197).
- Regras 1, 2, 8 e 9 do `CLAUDE.md` (withTenant, RLS + guardas, auditoria, `FABRICAS`). Migrations com `DATABASE_URL_MIGRATOR`.
- Textos de interface em pt-BR. Rotas do portal mantêm `?v=` do vínculo (`telaDoPortal`).

## Review Focus

1. **Fuso e virada do dia** — tenant em `America/Manaus` ou `America/Noronha`: os slots saem na hora local, e o "dia" usado no teto e no "já registrou no diário" é o do tenant, não UTC. Teste em `slots.test.ts` (Tarefa 2) e `envio.test.ts` (Tarefa 4).
2. **Plano republicado ou arquivado no meio do dia** — sem plano publicado nenhum slot de refeição/diário sai; refeição com horário mudado não reenvia um slot já enviado no mesmo dia. Teste em `envio.test.ts` (Tarefa 4).
3. **Paciente com dois consultórios** — os lembretes e as inscrições de push de um vínculo nunca saem pelo outro. Teste em `envio.test.ts` (Tarefa 4).
4. **Worker parado e de volta** — depois de 30 min parado, nada atrasado sai; só o slot do minuto corrente (≤ 10 min). Teste em `envio.test.ts` (Tarefa 4).
5. **Paciente desligou, nutricionista edita** — editar o lembrete não limpa `desligado_pelo_paciente_em` (módulo e gatilho do banco). Teste em `equipe.test.ts` (Tarefa 3) e `banco.test.ts` (Tarefa 1).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/db/schema/lembretes.ts` | Tabelas `lembretes_rotina` e `lembretes_rotina_envios` |
| `src/db/schema/pacientes.ts` (modificar) | Coluna `lembretes_pausados_em` |
| `drizzle/0118_lembretes_rotina.sql` (gerada) + `drizzle/0119_rls_lembretes_rotina.sql` (custom) | Tabelas; RLS, auditoria, gatilhos, `paciente_colunas` |
| `src/modules/plataforma/audit.ts` (modificar) | Rótulo `Lembretes no app` no Histórico de acessos |
| `src/modules/lembretes/constantes.ts` | Limites, prioridades, textos do push, mensagens de validação e formatadores (rótulos da tela ficam nos `.tsx`) |
| `src/modules/lembretes/config.ts` | Tipos e validação da configuração |
| `src/modules/lembretes/slots.ts` | Cálculo puro do plano do dia |
| `src/modules/lembretes/equipe.ts` | Leitura e escrita pela equipe |
| `src/modules/lembretes/paciente.ts` | Leitura e escrita pelo paciente |
| `src/modules/lembretes/envio.ts` | Job do worker |
| `src/modules/notificacoes/push-dispositivos.ts` | Inscrições dos pacientes em lote e envio aos dispositivos (extraído de `enviar.ts`) |
| `src/app/painel/pacientes/[id]/plano-alimentar/lembretes/*` | Seção do painel |
| `src/app/p/(portal)/perfil/lembretes/*` | Página Eu › Lembretes (inclui `ativar-aviso.tsx`) |
| `src/app/p/(portal)/inicio/page.tsx`, `cartoes-do-aparelho.tsx` (modificar) | Texto do cartão de notificações com lembretes |
| `src/modules/ajuda/conteudo.ts`, `src/modules/ajuda/portal.ts` (modificar) | Guia `plano-alimentar` v2 e guia do portal v3 |
| `e2e/lembretes.spec.ts` | E2E dos lembretes |

---

### Task 1: Banco — tabelas, RLS, auditoria e guardas

**Files:**
- Create: `src/db/schema/lembretes.ts`; export em `src/db/schema/index.ts`
- Modify: `src/db/schema/pacientes.ts` (coluna `lembretesPausadosEm: timestamp('lembretes_pausados_em', { withTimezone: true })`)
- Create: `drizzle/0118_lembretes_rotina.sql` (`pnpm db:generate`), `drizzle/0119_rls_lembretes_rotina.sql` (`pnpm drizzle-kit generate --custom --name rls_lembretes_rotina`)
- Modify: `src/db/rls-guard.ts` (`STAFF_ONLY`, `PACIENTE_ESCREVE`; o motivo de `PACIENTE_ESCREVE.patients` passa a citar a pausa dos lembretes), `src/db/audit-guard.ts` (`AUDIT_EXCEPTIONS`), `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO.lembretes = 'Lembretes no app'`)
- Modify: `test/isolamento.test.ts` — `FABRICAS` das duas tabelas; `COM_MAE` e `IMUTAVEIS` com `lembretes_rotina_envios`; `IMUTAVEIS` com `lembretes_rotina` (comentário: `Plano 17: lembretes_rotina_regras (0119) recusa mudar tenant_id/patient_id (colunas fixas) com 42501 antes da RLS`); `lembretes_rotina` em `ULTIMAS`, antes de `patients` (é mãe com CASCADE de `lembretes_rotina_envios`; comentário de `ULTIMAS` citando o Plano 17); filtro de `SO_APAGA.patients` se preciso. Fábrica de `lembretes_rotina`: `insert into lembretes_rotina (tenant_id, patient_id, tipo, config, criado_por) values (${t}, ${p}, 'agua', '{…config válida…}', coalesce(app_current_user(), gen_random_uuid()))`. A de `lembretes_rotina_envios` cria a mãe no mesmo comando por CTE, como `suplemento` com texto (não colide com o índice único parcial da `agua` que a outra fábrica gravou). O `beforeAll` semeia essa tabela com `role: 'worker'` (ex.: `PAPEL_DA_FABRICA: Record<string, TenantRole> = { lembretes_rotina_envios: 'worker' }`, usado no laço das fábricas, linha ~260); os testes negativos continuam como nutri/paciente/publico/conta, e a recusa vem da RLS da mãe.
- Test: `src/modules/lembretes/banco.test.ts`; `src/modules/plataforma/audit.test.ts` (`expect(ENTIDADE_ROTULO.lembretes).toBe('Lembretes no app')`)

**Interfaces:**
- Produces: `lembretesRotina`, `lembretesRotinaEnvios`, `LembreteRotinaRow`, `patients.lembretesPausadosEm`.

Tabela `lembretes_rotina`: `id uuid pk`, `tenant_id`, `patient_id` (FK composta para `patients`), `tipo text` CHECK `in ('agua','refeicoes','suplemento','livre')`, `config jsonb not null`, `texto text` com CHECK `lembretes_rotina_texto_por_tipo`: `(tipo in ('agua','refeicoes') and texto is null) or (tipo = 'suplemento' and texto is not null and char_length(btrim(texto)) between 1 and 60) or (tipo = 'livre' and texto is not null and char_length(btrim(texto)) between 1 and 120)`, `ligado boolean not null default true`, `desligado_pelo_paciente_em timestamptz`, `criado_por uuid not null`, `created_at`, `updated_at`; índice único parcial `(tenant_id, patient_id, tipo) where tipo in ('agua','refeicoes')`; `unique (tenant_id, patient_id, id)`.
Tabela `lembretes_rotina_envios`: `lembrete_id uuid pk`, `tenant_id`, `patient_id`, `ultimo_slot_em timestamptz not null`, `updated_at`; FK `(tenant_id, patient_id, lembrete_id)` → `lembretes_rotina` `ON DELETE CASCADE`.

Migration 0119 (molde da 0116):
- `app_enable_tenant_rls` + `app_enable_patient_rls` nas duas; `app_enable_audit('lembretes_rotina', 'lembretes')`; `app_enable_staff_only('lembretes_rotina_envios')`.
- `app_allow_paciente_escrita('lembretes_rotina', 'update')` + gatilho `lembretes_rotina_regras` (BEFORE UPDATE, comparações com `IS DISTINCT FROM`, para o UPDATE sem mudança passar): sessão `paciente` só muda `desligado_pelo_paciente_em` e `updated_at`; colunas `id, tenant_id, patient_id, tipo, criado_por, created_at` fixas para todos; `desligado_pelo_paciente_em` só muda na sessão `paciente` (ao ir para valor, `NEW.desligado_pelo_paciente_em := clock_timestamp()`) ou no `worker`/contexto vazio — a sessão `nutri` não muda essa coluna (42501); `publico`/`conta` nada.
- Gatilho `lembretes_rotina_envios_do_worker` (BEFORE INSERT OR UPDATE): contexto vazio e `worker` passam. Nos outros papéis, recusa (42501) o INSERT e o UPDATE que mude alguma coluna (`to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)`), assim o UPDATE sem mudança passa. `tenant_id`, `patient_id` e `lembrete_id` ficam fixos para todos.
- Gatilho `patients_lembretes_do_paciente` (BEFORE UPDATE ON patients, molde de `app_patients_ia_quem`, 0099): `lembretes_pausados_em` só muda na sessão `paciente` (nulo ↔ valor; ao ir para valor, `NEW.lembretes_pausados_em := clock_timestamp()`) ou no `worker`/contexto vazio (anonimização). Exceção única da sessão `nutri`: a limpeza no mesmo UPDATE que leva o paciente a `bloqueado` (exclusão atendida, Tarefa 7: `OLD.status <> 'bloqueado' and NEW.status = 'bloqueado' and NEW.lembretes_pausados_em is null`). Fora disso, `nutri`, `publico` e `conta` recebem 42501.
- `CREATE OR REPLACE FUNCTION` da função de `paciente_colunas` (`app_paciente_colunas_patients`, 0085) com `'lembretes_pausados_em'` acrescentado a `livres`; o resto copiado linha a linha — da versão vigente na `main` no momento de gerar/regenerar a migration (`grep -l app_paciente_colunas_patients drizzle/*.sql`, a de número maior), não da 0085 se outra a tiver redefinido. A mensagem do 42501 passa a `a sessão de paciente só altera o aceite do convite, o WhatsApp e a pausa dos lembretes`.
- `AUDIT_EXCEPTIONS.lembretes_rotina_envios`: `'registro técnico de envio (último horário enviado); nenhum dado clínico — a configuração fica em lembretes_rotina, que é auditada'`.

- [ ] **Step 1: Escrever os testes que falham** em `banco.test.ts`:
  - `paciente só desliga o próprio lembrete` — sessão de paciente: UPDATE de `desligado_pelo_paciente_em` passa e o valor gravado é o do banco (`clock_timestamp()`); UPDATE de `config`, `ligado` ou `texto` → erro `42501`.
  - `paciente pausa os próprios lembretes` — UPDATE de `patients.lembretes_pausados_em` pela sessão de paciente passa.
  - `nutricionista não religa` — UPDATE de `desligado_pelo_paciente_em` e de `patients.lembretes_pausados_em` pela sessão `nutri` → `42501`; UPDATE sem mudança passa; a limpeza de `lembretes_pausados_em` junto da ida a `bloqueado` passa.
  - `marca de envio só pelo worker` — INSERT em `lembretes_rotina_envios` com papel `nutri` → `42501`; UPDATE sem mudança pela `nutri` passa; com `worker` passa.
  - `escrita da equipe vira audit_log` — INSERT pela sessão `nutri` grava `audit_log` com entidade `lembretes`; UPDATE da marca pelo worker não grava.
  - `CHECK do texto por tipo` — `agua` com texto, `suplemento` sem texto (NULL) ou só com espaços → violação de CHECK.
  - Em `audit.test.ts`: `ENTIDADE_ROTULO.lembretes` é `Lembretes no app`.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/banco.test.ts` → FAIL (tabelas não existem).
- [ ] **Step 3:** schema, `pnpm db:generate`, migration custom, `pnpm db:migrate`.
- [ ] **Step 4:** `pnpm vitest run src/modules/lembretes/banco.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/modules/plataforma/audit.test.ts test/isolamento.test.ts` → PASS.
- [ ] **Step 5:** commit `feat(lembretes): tabelas, RLS e auditoria dos lembretes de rotina (P17-01)`.

---

### Task 2: Regras puras — configuração e plano do dia

**Files:**
- Create: `src/modules/lembretes/constantes.ts`, `src/modules/lembretes/config.ts`, `src/modules/lembretes/slots.ts`
- Test: `src/modules/lembretes/config.test.ts`, `src/modules/lembretes/slots.test.ts`, `src/modules/lembretes/constantes.test.ts`

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
export type SemTexto<T> = T extends unknown ? Omit<T, 'texto'> : never;
export function validarLembrete(input: unknown): { ok: true; valor: LembreteNovo } | { ok: false; erros: Record<string, string> };
export function validarConfig(tipo: LembreteNovo['tipo'], config: unknown): { ok: true; valor: SemTexto<LembreteNovo> } | { ok: false }; // validarLembrete sem o texto (worker)
export function sugestaoInicial(): LembreteNovo[]; // água 08:00–20:00 / 120 / todos os dias; refeições 0 / null
// slots.ts
export type TipoSlot = 'refeicao' | 'diario' | 'suplemento' | 'livre' | 'agua';
export type LembreteParaSlots = { id: string; ativo: boolean; validoDesde?: Date } & SemTexto<LembreteNovo>; // LembreteNovo com texto continua atribuível
export type RefeicaoDoPlano = { nome: string; horario: string | null }; // 'HH:MM' ou null
export type Slot = { em: Date; tipo: TipoSlot; lembreteIds: string[]; refeicao: string | null };
export function planoDoDia(e: {
  lembretes: LembreteParaSlots[]; refeicoes: RefeicaoDoPlano[]; data: string /* AAAA-MM-DD no fuso */; fuso: string;
  refeicoesNoDiario?: string[]; // nomes das refeições do plano já registradas no dia local (só o worker passa)
}): { slots: Slot[]; cortados: { total: number; tipos: TipoSlot[] }; refeicoesSemHorario: string[]; refeicoesForaDaJanela: string[] };
export function maiorDiaDaSemana(e: Omit<Parameters<typeof planoDoDia>[0], 'data'>): number; // maior total entre os 7 dias da semana
// constantes.ts (formatadores comuns ao painel e ao portal)
export function rotuloDoIntervalo(min: ConfigAgua['intervaloMin']): string;
export function rotuloDosDias(dias: DiaDaSemana[]): string;
export function rotuloDaAntecedencia(min: ConfigRefeicoes['antecedenciaMin']): string;
export function rotuloDoDiario(min: ConfigRefeicoes['diarioDepoisMin']): string;
```
`planoDoDia`: gera os slots de cada lembrete `ativo` no dia (água: de `inicio` a `fim` de `intervaloMin` em `intervaloMin`; refeição: `horario − antecedenciaMin`; diário: `horario + diarioDepoisMin`; suplemento/livre: cada horário); descarta os slots de um lembrete com `em < validoDesde` e, **antes** da janela, da fusão e do teto, os slots `diario` das refeições em `refeicoesNoDiario`; descarta os fora da janela 06:00–22:00, funde os do mesmo minuto num só (tipo de maior prioridade, `lembreteIds` unidos; na fusão de duas refeições no mesmo minuto, `refeicao` = a primeira na ordem de `refeicoes`) e, acima de 24, corta pelos de menor prioridade (`cortados.total` = quantos saíram, `cortados.tipos` = os tipos atingidos). Ordenado por `em`.

`constantes.ts` guarda só os textos do push, as mensagens de validação e os formatadores; os rótulos de botão e de campo ficam nos `.tsx` das seções (Tarefas 5 e 6). Se algum rótulo citado entre aspas num guia morar no módulo, acrescentar `'src/modules/lembretes'` ao array `TSX_FORA` de `src/modules/ajuda/conteudo.test.ts` na mesma tarefa.
- Formatadores: `rotuloDoIntervalo` 60 → `1 h`, 90 → `1h30`, 120 → `2 h`, 180 → `3 h`, 240 → `4 h`. `rotuloDosDias`: os 7 dias → `todos os dias`; segunda a sexta exatos → `seg a sex`; sábado e domingo → `sáb e dom`; senão a lista abreviada em ordem seg…dom (`seg, qua e sex`). `rotuloDaAntecedencia`: `na hora` / `15 min antes` / `30 min antes`. `rotuloDoDiario`: `sem pedido de registro` / `pedir registro no diário 30 min depois` / `pedir registro no diário 60 min depois`.
- Mensagens de `validarLembrete` (chaves `inicio`, `fim`, `intervaloMin`, `dias`, `horarios`, `texto`, `antecedenciaMin`, `diarioDepoisMin`): horário fora da janela `Escolha um horário entre 06:00 e 22:00.`; dias vazio `Escolha ao menos um dia da semana.`; intervalo inválido `Escolha um intervalo da lista.`; horário repetido `Há dois horários iguais. Remova um deles.`; texto vazio `Escreva o nome do suplemento.` / `Escreva o texto do lembrete.`; texto longo `Use até 60 caracteres.` / `Use até 120 caracteres.`.

- [ ] **Step 1: Testes que falham.** `config.test.ts`: aceita a sugestão inicial; recusa `inicio` 05:30 (`{ inicio: 'Escolha um horário entre 06:00 e 22:00.' }`), `intervaloMin` 45 (`Escolha um intervalo da lista.`), 5 horários, dois horários iguais (`Há dois horários iguais. Remova um deles.`), texto de suplemento com 61 caracteres (`Use até 60 caracteres.`), `dias` vazio (`Escolha ao menos um dia da semana.`); `validarConfig` aceita suplemento sem texto e recusa config malformada. `constantes.test.ts`: os quatro formatadores com os exemplos acima. `slots.test.ts`:
  - `água 08–20 a cada 2h dá 7 slots` (08,10,…,20).
  - `refeição 30 min antes e diário 60 min depois` — Almoço 12:00 → slots 11:30 (`refeicao`) e 13:00 (`diario`).
  - `refeição sem horário não gera slot` e aparece em `refeicoesSemHorario`; `Ceia 22:30` em `refeicoesForaDaJanela`.
  - `mesmo minuto vira um push` — água 12:00 + Almoço 12:00 → 1 slot `refeicao` com os dois ids.
  - `teto 24 corta água primeiro` — água a cada 60 min 06:00–22:00 (17); refeições 07:30, 10:30, 12:30, 15:30, 18:30 e 20:30, `antecedenciaMin` 0, `diarioDepoisMin` 60 (diários 08:30 … 21:30; 12 slots, nenhum em hora cheia) → 24 slots, `cortados` `{ total: 5, tipos: ['agua'] }`, nenhum `refeicao` ou `diario` cortado.
  - `diário registrado não derruba a água do mesmo minuto` — Almoço 12:00, diário 60 min, água 13:00 e `refeicoesNoDiario: ['Almoço']` → 1 slot `agua` às 13:00.
  - `fuso` (Review Focus 1) — `America/Manaus`, água 08:00 em `2026-11-16` → `em` = `2026-11-16T12:00:00Z`.
  - `dia da semana` — suplemento só seg–sex não gera slot num sábado.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/config.test.ts src/modules/lembretes/slots.test.ts src/modules/lembretes/constantes.test.ts` → FAIL.
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
  previstoHoje: number; cortadosHoje: { total: number; tipos: TipoSlot[] }; refeicoesSemHorario: string[]; refeicoesForaDaJanela: string[];
  planoPublicado: boolean; aparelhosComNotificacao: number; pausadoEm: Date | null;
};
export async function lembretesDoPaciente(ctx: TenantContext, patientId: string, tenant: { fuso: string }, deps?: { db?: Db; agora?: Date }): Promise<VisaoDaEquipe>;
export async function salvarLembrete(ctx: TenantContext, patientId: string, input: unknown, tenant: { fuso: string }, deps?: { db?: Db }): Promise<{ id: string }>; // input com `id` opcional = edição
export async function ligarLembrete(ctx: TenantContext, patientId: string, id: string, ligado: boolean, deps?: { db?: Db }): Promise<void>;
export async function apagarLembrete(ctx: TenantContext, patientId: string, id: string, deps?: { db?: Db }): Promise<void>;
export class LembreteError extends Error { constructor(public erros: Record<string, string>) }
```
- `lembretesDoPaciente` lê pela sessão `nutri` (withTenant) e chama `auditRead(tx, …)` com entidade `lembretes` quando há lembretes, como a leitura do plano no painel (`src/modules/plano-alimentar/carregar.ts`). `sugestao` só preenche a primeira visão (paciente sem nenhum lembrete); a recriação de água ou refeições depois disso é pelos botões `Adicionar água`/`Adicionar refeições` da Tarefa 5, que abrem o formulário com o item correspondente de `sugestaoInicial()`.
- `salvarLembrete` trava o paciente, recusa paciente bloqueado/anonimizado, aplica os limites e recusa se `maiorDiaDaSemana` > 24 — contando **todos** os lembretes do paciente como ativos (inclusive os desligados pela equipe ou pelo paciente, com o lembrete editado no lugar do antigo), com as refeições do plano publicado; assim `ligarLembrete` e o religar do paciente nunca passam do teto e não precisam conferir. Mensagens: acima de 24, na chave `geral`, `Com este lembrete, o paciente receberia mais de 24 avisos em um dia. Diminua os horários ou aumente o intervalo da água.`; 6º suplemento `Você já tem 5 suplementos. Apague um para adicionar outro.`; 6º livre `Você já tem 5 lembretes livres. Apague um para adicionar outro.`; segunda água/refeições (índice único) `Este paciente já tem esse lembrete. Edite o que existe.`. Na edição mantém `desligado_pelo_paciente_em` (o gatilho da Tarefa 1 também impede).

- [ ] **Step 1: Testes que falham:** salva e lê a sugestão; `segunda água → erro` (índice único vira `LembreteError` com `Este paciente já tem esse lembrete. Edite o que existe.`); `6º suplemento → erro` com o texto exato; `acima de 24 → erro` com o texto exato na chave `geral`; `desligado conta no teto` — com 23 avisos de um lembrete desligado, salvar outro de 2 horários → erro com o texto exato; **Review Focus 5** `editar não religa o que o paciente desligou`; `outro tenant não vê` (RLS); `aparelhosComNotificacao` conta só as inscrições do vínculo; `planoPublicado` falso sem plano publicado.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/equipe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(lembretes): configuração pela equipe (P17-03)`.

---

### Task 4: Worker — job `lembretes-rotina`

**Files:**
- Create: `src/modules/notificacoes/push-dispositivos.ts`, `src/modules/lembretes/envio.ts`
- Modify: `src/modules/notificacoes/enviar.ts` (`enviarPush` passa a usar `enviarAosDispositivos`), `src/jobs/queues.ts` (`'lembretes-rotina': { retryLimit: 0, expireInSeconds: 120, deleteAfterSeconds: 3_600 }`), `src/worker/index.ts` (schedule `'* * * * *'`, tz `America/Sao_Paulo`)
- Test: `src/modules/lembretes/envio.test.ts`; `src/modules/notificacoes/enviar.test.ts` continua verde sem mudança

**Interfaces:**
- Consumes: Tarefa 2 (`planoDoDia`, `validarConfig`), Tarefa 1 (tabelas), `ProvedorPush`/`InscricaoPush` (`push.ts`), `listarTenantsParaVarredura`/`buscarTenant`, `getTenantStatus` (`src/modules/plataforma/tenant-status.ts`), `inicioDoDia` (`src/modules/agenda/fuso.ts`), `somarDias` (`src/modules/pacientes/datas.ts`), `rotuloDaRefeicao`/`refeicaoDoDiario` (`src/modules/portal/diario-constantes.ts`), `telaDoPortal` (`src/modules/portal/link-portal.ts`), `urlDoApp` (`src/lib/url-do-app.ts`).
- O corpo do push de refeição usa `refeicaoDoDiario(nome)` quando ≠ `'Outro'` e o texto genérico senão (Global Constraints), nunca `refeicao.nome` digitado nem o horário. `rotuloDaRefeicao` serve só para conferir o registro do diário (`refeicao_do_plano`).
- Produces:
```ts
// push-dispositivos.ts — o laço de enviarPush (envio, remoção das mortas, classificação), sem ContextoEnvio
export type ResultadoAoPaciente = 'enviada' | 'sem_inscricao' | 'incerta' | 'passageira' | 'definitiva';
export type InscricaoComId = InscricaoPush & { id: string };
export async function inscricoesDosPacientes(tx: Tx, patientIds: string[]): Promise<Map<string, InscricaoComId[]>>;
export async function enviarAosDispositivos(a: { db: Db; tenantId: string; inscricoes: InscricaoComId[]; push: ProvedorPush; payload: string; ttlS: number; logCtx: Record<string, string> }): Promise<{ resultado: ResultadoAoPaciente; codigo: string | null }>;
// envio.ts
export type DepsLembretes = { db: Db; agora: () => Date; appUrl: string; push: ProvedorPush | null };
export const CONCORRENCIA_ENVIO = 10;
export async function processarLembretes(deps: DepsLembretes): Promise<{ enviados: number; pulados: number; falhas: number }>;
```
`enviarPush` continua lendo as inscrições (vazio → `sem_inscricao`), depois monta o payload (`sem_modelo`) e só então chama `enviarAosDispositivos`, na ordem de hoje. A remoção de inscrição morta (410) abre uma transação curta só quando ocorre.

Fluxo por tenant `ativa` (contexto `worker`; push desligado — `deps.push` nulo — não marca nem envia):
1. **Leitura em lote** (uma transação, nenhuma consulta por paciente): (a) pacientes `ativo`, sem `anonimizado_em`, com `user_id`, sem `lembretes_pausados_em`, com `EXISTS` em `push_subscriptions`, e os lembretes deles `ligado` e sem `desligado_pelo_paciente_em` — sem selecionar `texto`; (b) refeições do plano `publicado` desses pacientes (`horario.slice(0, 5)`); (c) as marcas (`lembrete_id in …`); (d) os registros do diário do dia. Cada lembrete passa por `validarConfig` antes de `planoDoDia`; o inválido é pulado e contado (log só com `tenantId` e contagem). O worker passa `validoDesde = updated_at` do lembrete (o envio não mexe nesse `updated_at`: a marca fica em `lembretes_rotina_envios`).
2. **Diário já registrado:** uma refeição do plano conta como registrada se, no dia local do tenant (`[inicioDoDia(hoje, fuso), inicioDoDia(somarDias(hoje, 1), fuso))`, como `diaDe` em `diario.ts`), há linha em `diary_entries` do paciente com `refeicao_do_plano = rotuloDaRefeicao(nome, horario.slice(0, 5))` **ou**, quando `refeicaoDoDiario(nome) !== 'Outro'`, com `refeicao = refeicaoDoDiario(nome)`. Uma consulta por tenant (só `patient_id`, `refeicao`, `refeicao_do_plano`, nunca `texto`), para os pacientes com `diarioDepoisMin` não nulo; é conferência de estado do worker, sem `auditRead` (nada é devolvido a usuário). Essas refeições entram em `refeicoesNoDiario` de `planoDoDia`.
3. **Escolha:** `planoDoDia` do dia local; por paciente, o slot **mais antigo** ainda não enviado com `agora − 10 min < em ≤ agora` e `em >` `ultimo_slot_em` de todos os seus `lembreteIds` (um push por paciente por execução; o seguinte sai na execução do minuto seguinte, se ainda estiver na janela). Sem slot devido no tenant, a transação da marca nem abre.
4. **Marca** (transação curta por tenant): `select pg_advisory_xact_lock(hashtext('lembretes-rotina'), hashtext(tenantId))`; `getTenantStatus(tx, tenantId, { aguardarSuspensao: true })` (fora de `ativa`, nada); com os `lembreteIds` de cada slot em ordem, `INSERT INTO lembretes_rotina_envios (...) VALUES (...) ON CONFLICT (lembrete_id) DO UPDATE SET ultimo_slot_em = excluded.ultimo_slot_em, updated_at = excluded.updated_at WHERE lembretes_rotina_envios.ultimo_slot_em < excluded.ultimo_slot_em RETURNING lembrete_id`. Só sai o slot cujos `lembreteIds` voltaram todos no RETURNING (a escrita condicional é o que garante o no máximo uma vez; a trava só serializa). Na mesma transação, `inscricoesDosPacientes` dos pacientes com slot que vai sair.
5. **Envio** só depois do commit, fora da transação, com no máximo `CONCORRENCIA_ENVIO` envios em andamento ao mesmo tempo (fila de trabalho: quem termina pega o próximo), não em lotes fechados. Log técnico só com contagens e `tenantId`.

Payload: `{ titulo: 'NutriDebby', corpo, url }`; `url` = `/p/plano` (refeição), `/p/diario` (diário), `/p/perfil/lembretes` (suplemento, livre), `/p/inicio` (água), sempre por `telaDoPortal(…, tenantId)`.

- [ ] **Step 1: Testes que falham** (`ProvedorPush` falso que registra os payloads, `agora` controlado):
  - `envia a água das 10:00 às 10:00:30` e `não reenvia às 10:01`.
  - **Review Focus 4** `parado 30 min não envia atrasado` — `agora` 10:31 com slots 10:00 e 10:30 pendentes → só o das 10:30.
  - `atraso de 1 min não perde a refeição` — Almoço 12:00 (refeição) e o diário de outra refeição às 12:01; execução às 12:01:30 → sai a refeição das 12:00; às 12:02 → sai o diário das 12:01.
  - `duas execuções simultâneas não duplicam` — `Promise.all([processarLembretes(d), processarLembretes(d)])` com o mesmo `agora` → exatamente 1 payload.
  - `lembrete salvo às 10:03 não envia a água das 10:00`.
  - `sem plano publicado não há refeição` e **Review Focus 2** `plano republicado com Almoço de 12:00 para 12:05 depois do envio das 12:00 envia o das 12:05, não repete o das 12:00`.
  - `corpo da refeição` — 'Almoço' às 12:30 com antecedência 15 → exatamente `Está chegando a hora: Almoço`; com antecedência 0 → `Hora de: Almoço`; 'almoco' sem acento → `Hora de: Almoço`.
  - `refeição com nome fora da lista vai com texto genérico` — 'Lanche sem lactose' às 12:00 → corpo `Hora da sua refeição`, e `JSON.stringify(payload)` não contém 'lactose'.
  - `diário já registrado não pede registro` — tanto por `refeicao_do_plano` quanto só por `refeicao` da lista fechada.
  - `dia do diário é o do tenant` — tenant `America/Manaus`, registro de Almoço às 2026-11-17T03:30Z (23:30 do dia 16 local) não conta para o dia 17.
  - `paciente pausado, lembrete desligado pelo paciente, paciente arquivado, tenant suspenso → nada`.
  - `config inválida é pulada e contada` — as outras linhas do tenant continuam saindo.
  - **Review Focus 3** `paciente em dois consultórios` — o push do tenant A só vai às inscrições do vínculo A.
  - `payload e log de suplemento não contêm o nome` — `JSON.stringify(payload)` e o objeto logado não contêm o texto do suplemento.
  - `inscrição 410 é apagada` (via `enviarAosDispositivos`).
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/envio.test.ts` → FAIL.
- [ ] **Step 3:** extrair `inscricoesDosPacientes` e `enviarAosDispositivos` (comportamento idêntico; `enviarPush` mapeia o resultado para `Resultado`), implementar `processarLembretes`, registrar fila e cron.
- [ ] **Step 4:** `pnpm vitest run src/modules/lembretes/envio.test.ts src/modules/notificacoes/` → PASS.
- [ ] **Step 5:** commit `feat(lembretes): envio por push no worker (P17-04)`.

---

### Task 5: Painel — seção "Lembretes no app" na aba Plano alimentar

**Files:**
- Create: `src/app/painel/pacientes/[id]/plano-alimentar/lembretes/secao.tsx`, `.../lembretes/form-lembrete.tsx` (client), `.../lembretes/actions.ts`
- Modify: `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx` (renderiza a seção abaixo da lista de planos, passando o `status` do paciente que a página já lê)
- Modify: `src/modules/ajuda/conteudo.ts`, guia `plano-alimentar`: `versao` 1 → 2 (comentário `Plano 17: a seção Lembretes no app`); novo passo `{ alvo: 'lembretes-app', titulo: 'Lembretes no app', texto: 'Configure água, avisos das refeições do plano, suplemento e lembrete livre. O paciente pode desligar qualquer um; o nome do suplemento e o texto livre aparecem só dentro do app.' }` depois de `publicar-plano`; um item em "Perguntas comuns" sobre o limite de 24 avisos por dia e a janela 6h–22h. O `data-guia="lembretes-app"` vai no elemento raiz da seção em `secao.tsx` (no `<Cartao … data-guia="lembretes-app">`, se a seção usar `Cartao`, que repassa `resto`).
- Test: `.../lembretes/actions.test.ts`; `src/modules/ajuda/conteudo.test.ts` (`plano-alimentar` `toBe(2)` e teste do passo novo)

Os rótulos de botão e de campo ficam nos `.tsx` da seção; os resumos de cada lembrete usam os formatadores de `constantes.ts` (Tarefa 2), os mesmos do portal.

**Interfaces:**
- Consumes: Tarefa 3 (`lembretesDoPaciente`, `salvarLembrete`, `ligarLembrete`, `apagarLembrete`, `LembreteError`).
- Produces: `salvarLembreteAction(patientId, prev, formData)`, `ligarLembreteAction(patientId, id, ligado)`, `apagarLembreteAction(patientId, id)` (server actions, `revalidatePath` da aba).

Textos exatos:
- Título `Lembretes no app`; situação `Notificações: ativas em 1 aparelho` / `Notificações: ativas em {n} aparelhos` / `Este paciente ainda não ativou as notificações no app. Os lembretes começam quando ele ativar.`
- `Previsto para hoje: 1 lembrete` / `Previsto para hoje: {n} lembretes` / `Nenhum lembrete previsto para hoje.`; com corte só de água (`cortadosHoje.tipos` = `['agua']`): `Acima do limite de 24 por dia: alguns lembretes de água não serão enviados.`; com corte de outro tipo: `Acima do limite de 24 por dia: alguns lembretes não serão enviados.`
- Refeição sem horário: `{nome} sem horário — não gera lembrete`; fora da janela: `{nome} fora do horário dos lembretes (6h às 22h)`.
- Lembrete de refeições ligado e `planoPublicado` falso: `O paciente ainda não tem plano publicado: os avisos das refeições começam quando você publicar.`
- Paciente arquivado: `Paciente arquivado: os lembretes não são enviados.` (a seção continua editável).
- Desligado pelo paciente: `Desligado pelo paciente em {data}`; pausa geral: `O paciente pausou todos os lembretes em {data}.` (datas por `formatarDataNoFuso(data, tenant.fuso)`).
- Botões: `Adicionar suplemento`, `Adicionar lembrete livre`, `Editar`, `Salvar`, `Apagar`; sugestão: `Sugestão — confira e salve`, um cartão por tipo (água, refeições), cada um com o seu `Salvar`.
- `Adicionar água` e `Adicionar refeições` aparecem só quando o paciente ainda não tem aquele tipo e abrem o formulário já preenchido com a sugestão (água 08:00–20:00, a cada 2 h, todos os dias; refeições na hora, sem diário). `Adicionar suplemento` e `Adicionar lembrete livre` somem ao chegar a 5, e no lugar aparece `Limite de 5 suplementos.` / `Limite de 5 lembretes livres.`.
- Nome acessível de cada botão por lembrete começa pelo texto visível (WCAG 2.5.3): `Editar lembrete de água`, `Apagar lembrete de refeições`, `Salvar lembrete de água`; no suplemento e no livre entra o texto: `Editar suplemento Vitamina D`, `Editar lembrete livre {texto}`.
- Ajuda fixa no formulário do suplemento (só no painel, abaixo do campo do nome): `O lembrete não substitui a prescrição: composição, via e posologia vão na receita e no prontuário.`
- Sucesso numa região viva da seção (`<p role="status">` sempre montado, num componente que não sai da tela com o `revalidatePath`; só o texto muda): `Lembrete salvo.`, `Lembrete ligado.`, `Lembrete desligado.`, `Lembrete apagado.`. Depois de Salvar, o foco vai ao botão `Editar` do lembrete salvo; depois de Apagar, ao título `Lembretes no app` (`tabIndex={-1}`). Apagar pede confirmação `Apagar este lembrete? O paciente deixa de recebê-lo.`, reutilizando `BotaoAcao` (prop `confirmar`).
- Interruptor da equipe: `<button type="button" role="switch" aria-checked={ligado}>` rotulado pelo nome do lembrete (`aria-labelledby`), com a palavra visível `Ligado`/`Desligado` ao lado e alvo `min-h-11`. Com `desligadoPeloPacienteEm`, abaixo, em `text-suave`, `Desligado pelo paciente em {data}`; o interruptor da equipe continua mudando só `ligado` e não limpa a escolha do paciente.
- Paciente bloqueado: seção só leitura (sem botões nem interruptor), como o resto da aba.

Formulário:
1. Estado `FormLembreteState = { erros?: Record<string, string>; valores?: Record<string, unknown>; ok?: string; envio?: number }`, como `FormAgendaState`, com `key={state.envio}`. Chaves de erro: `inicio`, `fim`, `intervaloMin`, `dias`, `horarios`, `texto`, `antecedenciaMin`, `diarioDepoisMin`, `geral`.
2. `<form noValidate>`, para valerem as mensagens pt-BR do servidor.
3. A lista de horários (1 a 4) e as caixas de dias são controladas (`useState`). Os campos simples podem ser controlados ou repor `valores` por `defaultValue`, como `regra-form.tsx`. Um erro nunca apaga o que foi digitado.
4. Rótulos: `Início` e `Fim` (`type="time"`); `Intervalo` com `1 h`, `1h30`, `2 h`, `3 h`, `4 h`; `Aviso da refeição` com `Na hora`, `15 min antes`, `30 min antes`; `Pedir registro no diário` com `Não pedir`, `30 min depois`, `60 min depois`; `Dias da semana` em `<fieldset><legend>`, com caixas de nome acessível completo (`Segunda-feira` etc.) e alvo `min-h-11`; `Nome do suplemento` (`maxLength` 60) e `Texto do lembrete` (`maxLength` 120), com a dica `Aparece só dentro do app, nunca na tela de bloqueio do celular.`; `Horários`, com os botões `Adicionar horário` e `Remover horário N` (mínimo 1).
5. As mensagens vêm de `validarLembrete` (Tarefa 2) e de `salvarLembrete` (Tarefa 3); a de mais de 24 avisos (chave `geral`) aparece junto do botão Salvar.
6. Os erros por campo usam `role="alert"` ligado por `aria-describedby`, como `Campo`.

- [ ] **Step 1: Testes que falham** (`actions.test.ts`): a action devolve os erros de `LembreteError` por campo; sessão de outra usuária/tenant não salva; paciente bloqueado → erro. `conteudo.test.ts`: `plano-alimentar` na versão 2 com o passo `lembretes-app`.
- [ ] **Step 2:** `pnpm vitest run "src/app/painel/pacientes/[id]/plano-alimentar/lembretes" src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar a seção (componentes base V2, `min-h-11`, rótulos visíveis, erros ao lado do campo).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): lembretes no app na aba Plano alimentar (P17-05)`.

---

### Task 6: Portal — Eu › Lembretes

**Files:**
- Create: `src/modules/lembretes/paciente.ts`, `src/app/p/(portal)/perfil/lembretes/page.tsx`, `.../lembretes/actions.ts`, `.../lembretes/interruptor.tsx` (client), `.../lembretes/ativar-aviso.tsx` (client)
- Modify: `src/app/p/(portal)/perfil/page.tsx` — Eu ganha `<section aria-labelledby="eu-lembretes" className={CARTAO}>` com `<h2 id="eu-lembretes" className={H2}>Lembretes</h2>` e o link `Ver meus lembretes` (classe `LINK`), entre "Meus documentos" e "Notificações", só quando `temLembretes`
- Modify: `src/app/p/(portal)/inicio/page.tsx` (chama `temLembretes(ctx)` dentro do `Promise.all` e passa `comLembretes` a `CartoesDoAparelho`), `src/app/p/(portal)/inicio/cartoes-do-aparelho.tsx` (prop `comLembretes: boolean`; quando verdadeira, o texto do cartão de notificações vira `Ative as notificações para receber os lembretes da sua nutricionista.`, e o `aria-label` acompanha o texto mostrado; a chave de dispensa continua `notificacoes`)
- Modify: `src/modules/ajuda/portal.ts`: novo item em "Perguntas comuns": `Se a sua nutricionista configurou lembretes, eles ficam em Eu › Lembretes, e você pode desligar qualquer um.`; sem passo novo no tour (os 5 alvos ficam iguais); `versao` 2 → 3, com comentário. A subida dispara o aviso "O manual do app foi atualizado" para todos os pacientes — registrar no fechamento (Tarefa 8); se o dono preferir não disparar, a alternativa é acrescentar o item sem subir a versão, com essa justificativa no comentário.
- Test: `src/modules/lembretes/paciente.test.ts`, `.../perfil/lembretes/actions.test.ts`, `src/app/p/(portal)/perfil/page.test.ts` (ordem das seções e mock de `@/modules/lembretes/paciente`), `src/app/p/(portal)/inicio/page.test.ts`, `src/modules/ajuda/portal.test.ts` (`versao` `toBe(3)` e o item novo; mantidos os testes que proíbem peso/IMC e que nenhum passo comece com "Sua nutricionista")

**Interfaces:**
- Consumes: Tarefas 1–3; formatadores de `constantes.ts` (Tarefa 2).
- Produces:
```ts
export type LembreteDoPaciente = { id: string; tipo: LembreteNovo['tipo']; resumo: string; textoDaNutri: string | null; desligado: boolean };
export async function meusLembretes(ctx: TenantContext, deps?: { db?: Db }): Promise<{ lembretes: LembreteDoPaciente[]; pausadoEm: Date | null }>; // só ligados pela equipe
export async function desligarMeuLembrete(ctx: TenantContext, id: string, desligar: boolean, deps?: { db?: Db }): Promise<void>;
export async function pausarMeusLembretes(ctx: TenantContext, pausar: boolean, deps?: { db?: Db }): Promise<void>;
export async function temLembretes(ctx: TenantContext, deps?: { db?: Db }): Promise<boolean>; // algum lembrete `ligado` e sem `desligado_pelo_paciente_em`; a pausa geral não conta
```
- `meusLembretes` chama `auditRead(tx, { entidade: 'lembretes', entidadeId: null, patientId })` na mesma transação da sessão do paciente quando devolve algum lembrete (molde: `diario.ts:216`; como a leitura do plano no portal). `temLembretes` (só sim/não) não chama.

Textos exatos: título `Lembretes`; introdução `Sua nutricionista configurou estes lembretes. Você pode desligar qualquer um ou pausar todos; ela vê o que você desligou ou pausou e se as notificações estão ativas.`; `Pausar todos os lembretes` / `Retomar os lembretes`; aviso da pausa `Lembretes pausados. Você não vai receber avisos até retomar.`; detalhe do suplemento/livre `Sua nutricionista: {texto}`.
- Resumos (mesmos formatadores do painel): água `Água: das {inicio} às {fim}, a cada {rotuloDoIntervalo} · {rotuloDosDias}` (ex.: `Água: das 08:00 às 20:00, a cada 2 h · todos os dias`); refeições `Refeições: aviso {rotuloDaAntecedencia}, nas refeições do seu plano` (ex.: `Refeições: aviso na hora, nas refeições do seu plano`); suplemento `Suplemento: {horários} · {rotuloDosDias}` (ex.: `Suplemento: 08:00 e 20:00 · seg a sex`); livre `Lembrete: {horários} · {rotuloDosDias}` (ex.: `Lembrete: 08:00 · todos os dias`).
- Página: `requirePaciente('/p/perfil/lembretes')` e `CabecalhoDetalhe titulo="Lembretes" voltar={{ href: '/p/perfil', secao: MSG_G.titulos.eu }}`, como `perfil/ia/page.tsx`. Sem nenhum lembrete ligado pela equipe, não redireciona: mostra `Sua nutricionista ainda não configurou lembretes para você.` (o push antigo abre algo com sentido). Se a leitura falhar, vale o `error.tsx` do portal.
- `ativar-aviso.tsx`, no molde de `CartoesDoAparelho`: `<AtivarNotificacoes chavePublica dono cartao={(c) => <section aria-label="Notificações" className="space-y-2 rounded-2xl border border-borda bg-cartao p-3"><p>Ative as notificações para receber os lembretes da sua nutricionista.</p>{c}</section>} />` — o texto só aparece quando dá para ativar ou quando a tentativa falhou. Para o iPhone fora da tela inicial, o mesmo arquivo usa `<Instalar cartao={(c) => <section …><p>Para receber os lembretes no iPhone, instale o app na tela inicial.</p>{c}</section>} />`, que já mostra os passos do iOS e não aparece quando não há o que instalar.
- Interruptor: `<button type="button" role="switch" aria-checked={!desligado} aria-labelledby={idDoResumo}>` numa linha `min-h-11`, com o texto visível `Ligado`/`Desligado` ao lado. Trilho e marcador só com tokens do portal (`border-campo`, `bg-destaque`), com contraste não textual ≥ 3:1 nos modos claro e escuro (WCAG 1.4.11). Estado controlado (`useOptimistic`/`useTransition`) que volta ao valor salvo se a action falhar, com `<p role="alert">Não foi possível salvar. Verifique a conexão e tente de novo.</p>`. Uma `<p role="status">` sempre montada na página anuncia `Lembrete desligado.` / `Lembrete ligado.` / `Lembretes pausados.` / `Lembretes retomados.`. `Pausar todos os lembretes`/`Retomar os lembretes` é o mesmo botão com o rótulo trocado, para o foco ficar. Com a pausa ativa, aparece no topo o aviso da pausa, e os interruptores individuais continuam usáveis e mostrando Ligado/Desligado.

- [ ] **Step 1: Testes que falham:** paciente lê só os próprios (RLS, outro paciente do mesmo tenant não aparece); desligado pela equipe (`ligado = false`) não aparece; `desligarMeuLembrete` grava a data e o religar a limpa; `pausarMeusLembretes` grava/limpa `lembretes_pausados_em`; a action recusa id de outro paciente; `meusLembretes` com lembretes grava `ler` de `lembretes` no `audit_log`, sem lembretes não grava; `temLembretes` não grava `auditRead` e é falso quando o único lembrete foi desligado pelo paciente; Eu mostra a seção Lembretes só com `temLembretes`; Hoje passa `comLembretes`; `portal.test.ts` na versão 3.
- [ ] **Step 2:** `pnpm vitest run src/modules/lembretes/paciente.test.ts "src/app/p/(portal)/perfil" "src/app/p/(portal)/inicio/page.test.ts" src/modules/ajuda/portal.test.ts` → FAIL.
- [ ] **Step 3:** implementar (molde visual de Eu, `font-portal-titulo`, `CARTAO`/`H2` copiados ou exportados de um arquivo comum). O detalhe e o resumo com `texto` (nome do suplemento e texto livre) levam `wrap-break-word`.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(portal): Eu › Lembretes (P17-06)`.

---

### Task 7: LGPD — exportação e apagamento

**Files:**
- Modify: `src/modules/pacientes/exportacao-job.ts` (`montarDados`: chave nova `lembretesDeRotina` com `{ tipo, config, texto, ligado, desligadoPeloPacienteEm, criadoEm }[]` — a chave `lembretes` já é das mensagens de consulta, Plano 05, e fica como está — e `lembretesPausadosEm` dentro de `paciente`, como `pesoOcultoNoAppEm`; sem a marca de envio). Atualizar os literais de `DadosExportacao` em `exportacao.test.ts` (~:635 e ~:1082).
- Modify: `src/modules/pacientes/lgpd.ts` — na exclusão atendida (`atenderPedidoExclusao`, junto do `tx.delete(pushSubscriptions)`) e na anonimização (`anonimizarVencidos`, junto do `tx.delete(pushSubscriptions)` sob `if (r.length)`, ~:565, contexto worker): apagar `lembretes_rotina` do paciente (a marca sai em cascata) e pôr `lembretesPausadosEm: null` no UPDATE de `patients` de cada uma (na exclusão atendida, no mesmo UPDATE que leva a `bloqueado` — a exceção do gatilho `patients_lembretes_do_paciente`, Tarefa 1).
- Test: `src/modules/pacientes/exportacao.test.ts`, `src/modules/pacientes/lgpd.test.ts` (casos novos)

Classificação (normas): a configuração dos lembretes é ajuste do app, não prontuário. A conduta (plano alimentar, receita do suplemento) fica nos registros próprios (Res. CFN 594/2017; Res. CFN 656/2020, art. 3º, XI e XII). Por isso a equipe apaga de fato, e a exclusão atendida apaga na hora, como as notificações no aparelho e as conversas da IA Nutri (termo 1.0, §24); o `audit_log` guarda quem criou, alterou e excluiu, sem o conteúdo. Registrar essa frase num comentário em `lgpd.ts`, junto ao `delete(pushSubscriptions)`. Backlog (E-09, opcional): citar "os lembretes do app" no §24 na próxima versão do termo.

- [ ] **Step 1: Testes que falham:** `dados.json traz lembretesDeRotina (sem ultimo_slot_em) e mantém lembretes das consultas`; `anonimização apaga os lembretes e as marcas e limpa a pausa`; `exclusão atendida apaga os lembretes e as marcas e limpa a pausa`.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(lgpd): lembretes na exportação e no apagamento (P17-07)`.

---

### Task 8: Fechamento — E2E, manuais e ajuda

**Files:**
- Create: `e2e/lembretes.spec.ts` — reserva um bloco de IP novo (comentário no cabeçalho, sem colidir com os blocos existentes)
- Modify: `e2e/acessibilidade.spec.ts` (`/p/perfil/lembretes`, com lembretes e vazia, em `ROTAS` e na lista do teste de 320 px com fonte a 200%), `scripts/e2e-seed.ts` (plano publicado com horários, se precisar; a paciente da suíte de acessibilidade recebe um lembrete livre com `Leia ${LINK_LONGO}`, ≤ 120 caracteres)
- Modify: `docs/manual-tecnico/05-agenda-portal-conteudo.md` (§5.3 nova subseção "Lembretes de rotina", com a frase de classificação da Tarefa 7; §5.8.1: linha `Plano 17: guia plano-alimentar na v2 (passo e pergunta da seção Lembretes no app) e portal-novidades na v3 (Lembretes em Eu)`, ajustada ao que as Tarefas 5 e 6 fizeram de fato), `docs/manual-tecnico/02-banco-de-dados.md` (tabelas), `docs/manual-tecnico/README.md` (glossário e divergências, se houver)
- Test: o próprio E2E

- [ ] **Step 1: E2E que falha:** nutricionista abre a aba Plano alimentar → salva a sugestão (botões `Salvar lembrete de água` e `Salvar lembrete de refeições`) → vê `Previsto para hoje`; paciente abre Eu › Lembretes → vê a introdução exata da Tarefa 6 e "Água" → desliga → a nutricionista vê `Desligado pelo paciente em …`. Axe nos três modos do painel (claro, escuro, igual ao aparelho escuro, com `escolherTema` e `emulateMedia`, voltando a "Igual ao aparelho" no `afterAll`), nos estados que `ROTAS_DO_PAINEL` não cobre: seção com lembretes salvos (incluindo `Desligado pelo paciente em …`) e formulário de suplemento aberto com erro. Em `acessibilidade.spec.ts`, `/p/perfil/lembretes` com o link longo passa no `scrollWidth <= innerWidth` a 320 px. Seletores pelos nomes acessíveis da Tarefa 5.
- [ ] **Step 2:** `pnpm test:e2e e2e/lembretes.spec.ts e2e/acessibilidade.spec.ts` → FAIL.
- [ ] **Step 3:** ajustes que o E2E pedir; manual técnico pelo agente `guardiao-manual`; correções do manual do usuário (Docs) e da Central de Ajuda preparadas para o dono; registrar no fechamento que o guia do portal na v3 mostra "O manual do app foi atualizado" a todos os pacientes.
- [ ] **Step 4:** `pnpm test:e2e e2e/lembretes.spec.ts e2e/acessibilidade.spec.ts && pnpm test && pnpm lint && pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 17 (P17-08)`.

---

## Revisão do plano (16/11/2026)

Lentes banco, normas, interface e worker; achados verificados aplicados acima. Decisões que mudam o plano:
- NORMAS-DECISAO-1: o nome da refeição vai ao push só como `refeicaoDoDiario(nome)` quando ≠ `'Outro'`; fora da lista fechada, texto genérico.
- NORMAS-DECISAO-2: suplemento com nome livre, sem vínculo com a receita, aprovado, com ajuda fixa no formulário do painel.
- NORMAS-03: a configuração é ajuste do app, não prontuário — apagada de fato pela equipe, na exclusão atendida e na anonimização (prevalece sobre "manter até a anonimização").
- A marca de envio é gravada com upsert condicional (`WHERE ultimo_slot_em < excluded…`), sob trava por tenant; só sai o slot cujos ids voltaram no RETURNING.
- O worker escolhe o slot devido **mais antigo**, não o mais recente (um atraso de 1 min não perde a refeição).
- O diário já registrado é filtrado em `planoDoDia` antes da janela, da fusão e do teto (`refeicoesNoDiario`).
- "A nutricionista não religa" passa a valer no banco (gatilhos em `lembretes_rotina` e `patients`).

## Depois das tarefas (fluxo do CLAUDE.md)

Revisão final do branch (workflow, com `revisor-rls`, `normas-cfn-lgpd` — confere a aplicação de NORMAS-DECISAO-1 (nome da refeição no push) e NORMAS-DECISAO-2 (suplemento sem receita, com a ajuda no formulário) —, `revisor-interface`, `guardiao-manual`) → uma onda de correções → `/code-review high` no PR uma vez → correções Critical/Important → re-revisão do diff das correções → `/security-review` → merge **só com o OK do dono** (merge = deploy; a migration roda no boot).
