# Plano 09 — Fechamento do MVP (itens técnicos P09-01 a P09-05): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Pedido e aprovado pelo dono em 06/10/2026** ("pode seguir no modo misto, definirei o layout mais pra frente"). Escopo: só os itens técnicos **P09-01 a P09-05**. Ficam fora: **P09-00** (textos jurídicos, validação com a Debby, débitos Minor) e **P09-06** (Status do sistema). Escrito a partir de `origin/main` @ `3991c7d` (Planos 01–08 e 10A em produção; migrations `0000`–`0093`). Nenhuma linha de código foi escrita; nada foi rodado em banco. A arte do ícone do painel (T5) é **provisória**: o dono define o layout depois.

**Goal:** Fechar cinco pontas técnicas do MVP: conferência de origem no salvamento do plano alimentar, worker que espera o schema no deploy, reinício do 2FA pelo admin, aviso claro quando o aparelho está com outra conta, E2E estável e o painel da nutricionista instalável sem cópia offline de dado de saúde.

**Architecture:** Mudanças pequenas e locais, uma tarefa por item. T1 põe `mesmaOrigem` no `PUT /api/painel/planos/[id]` e cria uma guarda que chama toda rota de escrita com cookie usando uma origem estranha. T2 (a) cria a função `app_versao_do_schema()` (SECURITY DEFINER, `0094`) e o worker espera por ela antes do `boss.start()`; (b) cria `reiniciarDoisFatores` (`src/modules/plataforma/reiniciar-2fa.ts`), a tabela `admin_actions` (só INSERT, `0095`/`0096`), o formulário no `/admin`, o e-mail de aviso e o comando `admin:reiniciar-2fa` para quando nenhum admin consegue entrar. T3 troca o redirect calado do caso `forbidden` por `/conta/outro-papel?esperado=<papel>`. T4 corrige as três corridas de E2E achadas nos logs do CI. T5 cria um manifest próprio do painel (`/painel.webmanifest`, id `/painel`, ícones próprios) e guardas de que nenhum service worker cobre o painel.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16 (App Router, `src/proxy.ts`, Route Handlers, `metadata.manifest`) · PostgreSQL 16 · Drizzle 0.45 · pg-boss 12 · Better Auth 1.7 (`twoFactor`) · Vitest + Testcontainers · Playwright 1.63 + axe. **Nenhuma dependência nova.**

**Spec:** não há spec nova. Os itens nascem do manual técnico e do backlog: [`docs/manual-tecnico/01-visao-geral-e-arquitetura.md`](../../manual-tecnico/01-visao-geral-e-arquitetura.md) (§1.11 item 6; divergências 3 e 12), [`docs/manual-tecnico/06-worker-seguranca-operacao.md`](../../manual-tecnico/06-worker-seguranca-operacao.md) (§6.2.1; §6.9.1 "Plano para o 2FA ao trocar `AUTH_SECRET`"), a spec do MVP [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (§9.7 "o worker espera a versão do schema"; RNF-06; RNF-10; US-040) e os logs dos runs do CI 37304638500 (tentativa 1, job 111745259756) e 37325291299 (tentativa 1, job 111814360729).

## Global Constraints

- Tudo dos Planos 01–10A continua valendo: TypeScript `strict`, `pnpm install --frozen-lockfile`, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI. Ler o guia certo em `node_modules/next/dist/docs/` antes de escrever código Next (AGENTS.md).
- `requireNutri` na **primeira** linha de toda página e Server Action da nutricionista; `requireUser(['admin'], …)` na primeira linha de toda Server Action do admin (guarda `src/app/painel/acoes-de-paciente.test.ts`); `requireApiNutri`/`requireApiPaciente` nos Route Handlers.
- Rota de API com cookie que muda estado: **`mesmaOrigem(req)` antes da sessão**, resposta 403 (guarda nova da T1).
- CLAUDE.md regra 1: acesso à tabela `user` (e `two_factor`, `session`) fora de `withTenant` só nos arquivos listados. A T2 acrescenta `src/modules/plataforma/reiniciar-2fa.ts` à lista **no mesmo commit** do código. O admin nunca toca tabela com `tenant_id` (guarda `src/app/admin/sem-tabelas-tenant.test.ts`: o módulo novo entra em `ARQUIVOS_DO_ADMIN`).
- Migrations: **`0094`–`0096`**, só com `DATABASE_URL_MIGRATOR` (regra 7). `0094_versao_do_schema` (custom, T2a), `0095_admin_actions` (gerada, T2b), `0096_admin_actions_somente_insercao` (custom, T2b). Expand/contract: nada é removido nem renomeado. Nunca rodar migration no banco de produção; o banco de dev é o do `docker-compose.dev.yml` (127.0.0.1:54329).
- CLAUDE.md regra 3 / RNF-11: log só com ids, nome do erro e SQLSTATE; nunca e-mail, token, segredo do TOTP, código de recuperação, mensagem de erro de banco.
- Textos de interface em pt-BR. Os textos novos deste plano estão na tabela "Textos novos" e são rascunho até a revisão do dono.
- Visual V2: em `src/app/painel` e `src/modules/*/ui` só tokens do tema (guarda `cores.test.ts`); cor fixa (`#1d6b5a`) só fora dessas pastas (manifest em `src/app/`).
- Acessibilidade (RNF-10): `<label for>`, erros com `role="alert"`, sucesso com `role="status"`, alvo de toque ≥ 44 px; axe sem violações nas telas novas (T3).
- Custo zero: nenhuma dependência paga, nenhum serviço novo, **nenhuma variável de ambiente nova** (o prazo do worker é constante no código).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção. Subagentes nunca consultam o banco de produção, nem para leitura. Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes. O comando `admin:reiniciar-2fa` (T2) **só é escrito e testado** aqui; rodar em produção é do dono, com OK e snapshot.
- Política de revisão por entrega (CLAUDE.md, "Revisão a cada entrega"): revisor por tarefa → revisão final do branch → `/code-review high` no PR uma vez → correções Critical/Important → re-revisão só do diff → `/security-review`. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**.

### Decisões de desenho

| # | Tema | Decisão | Motivo |
|---|---|---|---|
| D1 | Origem no `PUT` do plano (P09-01) | `mesmaOrigem` antes de `requireApiNutri`, 403 `{ erro: 'Acesso negado' }` (o editor já trata 403 como "parar" com a mensagem, `resposta.ts`). Guarda nova chama **toda** rota de `src/app/api/{painel,p,documento}` com `POST/PUT/PATCH/DELETE`, sem cookie e com `Origin: https://evil.example`, e exige 403 | A sessão nem é lida: a regra "origem antes da sessão" vira teste; rota nova sem a conferência quebra o CI |
| D2 | Como o worker sabe a versão (P09-02 a) | Função `app_versao_do_schema()` (SECURITY DEFINER, dona = migrator) devolve `max(created_at)` de `drizzle.__drizzle_migrations`, que o drizzle grava com o `when` do journal. O worker compara com o `when` da **última** entrada de `drizzle/meta/_journal.json` da própria imagem (a pasta `drizzle/` já é copiada no Dockerfile). Segue se `aplicada >= esperada` (banco mais novo que o worker também serve: expand/contract) | O role da aplicação não lê o schema `drizzle` e não deve ler; a função entrega só um número. Sem migration rodando no worker |
| D3 | Quanto o worker espera | Nova leitura a cada **3 s**, por até **5 min** (constantes). Erro na leitura (a função ainda não existe — o próprio deploy deste plano, SQLSTATE 42883 — ou banco fora) conta como "ainda não". Passou do prazo: log `error` e `SchemaAtrasadoError`; o processo sai com erro e o Swarm o reinicia (que confere de novo). O heartbeat tolera 10 min (`HEARTBEAT_MAX_AGE_MS`) | Sem variável nova; o `/api/health` não alarma numa espera normal |
| D4 | Registro do reinício do 2FA (P09-02 b) | Tabela **`admin_actions`** (sem `tenant_id`, fora da RLS; só INSERT/SELECT para a aplicação, `0096`) com admin, ação, conta-alvo (id e papel, **sem e-mail**) e origem (`admin` ou `cli`); mais o log `info` com ids e o **e-mail de aviso** à própria conta | `audit_log` exige tenant e o admin não toca tabela 🔒; o log do container some com ele; o e-mail é o controle que a dona da conta vê |
| D5 | Quem pode ser reiniciado | Qualquer conta com 2FA (admin, nutricionista), **menos a do próprio admin** pela tela. Sem 2FA ativo: recusa ("Esta conta não tem…"). Para o último admin travado, o comando `admin:reiniciar-2fa <email>` no container (origem `cli`), rodado só pelo dono | Trocar `AUTH_SECRET` trava todos os admins (2FA obrigatório): sem o comando, a tela não serviria justo no caso do §6.9.1 |
| D6 | Aviso de outro papel (P09-03) | Caso `forbidden` de `requireUser` → `/conta/outro-papel?esperado=<papel>` (painel, portal, admin e Server Actions). Página com o texto, o "Sair" do papel atual (`SairPortal` para paciente, `BotaoSair` para a equipe) e o link de volta. `esperado` fora da lista ou igual ao papel atual → home do papel. Nada da conta (nome, e-mail) aparece. As rotas de API continuam com 403 | Um lugar só (`src/lib/session.ts`); `/conta` já é protegido no proxy |
| D7 | Escopo do PWA do painel (P09-05) | `id: '/painel'`, `start_url: '/painel'`, **`scope: '/'`**. O app instalado separa-se do portal pelo `id` (o do portal é `/p/inicio`, `scope: '/p/'`) | Com `scope: '/painel'`, o login (`/entrar`, a cada 12 h ociosas, RNF-06) e `/conta/seguranca` saem do escopo: no iPhone abrem fora do app, que tem cookies próprios, e o login não volta para a janela instalada |
| D8 | Offline do painel | **Nenhum** service worker no painel: o do Serwist é registrado só em `src/app/p/sw-provider.tsx` com `scope: '/p/'`, e as regras do SW (`sw-regras.ts`) só tratam `/p/`. Guardas por teste. O HTML do painel já sai com `Cache-Control: no-store` (render dinâmico), conferido no E2E | Dado de saúde não fica no aparelho (LGPD, minimização) |
| D9 | E2E (P09-04) | Reproduzir cada corrida de forma determinística (`page.route`), corrigir a causa (esperar o que a tela faz sozinha) e deixar atraso proposital na rede do teste; **sem** aumentar `retries`. `manual.spec` passa a `retries: 0` (o estado do primeiro acesso é gasto na 1ª tentativa: a 2ª sempre falhava com outro erro) | "Corrija sem só aumentar retries" (pedido do dono) |

### Causas achadas nos logs do CI (P09-04)

| Teste | O que o log mostra | Causa |
|---|---|---|
| `e2e/manual.spec.ts:21` (run 37325291299, tentativa 1) | 1ª execução: `toBeHidden` falhou na linha 28 — **depois do `reload` o tour voltou**. Nova tentativa: `toBeVisible` falhou (o tour não abre mais) | O Esc chama `marcarGuiaAction` sem `await` (`guia-do-painel.tsx:20`, otimista) e o teste recarrega na hora: o `reload` corta o POST da Server Action (é o `Error: The destination stream closed early.` do servidor). Na nova tentativa (modo serial), o progresso já estava gravado ou parcialmente gravado, e o 1º acesso não acontece de novo |
| `e2e/portal.spec.ts:171` (run 37304638500, tentativa 1, falhou nas duas tentativas) | `getByRole('alert').filter({ hasText: 'Sessão expirada. Entre de novo.' })` não aparece | Ao abrir `/p/diario`, o `RegistrarAcesso` (`src/app/p/acesso.tsx`) faz `POST /api/p/acesso`, que **sempre** devolve `Set-Cookie` com o cookie de sessão renovado (`cookieDeSessaoRenovado`, P06-11). Se a resposta chega depois do `clearCookies()`, o cookie volta, o "Registrar" salva (200) e o alerta nunca aparece. Agravante possível: clicar "Registrar" antes da hidratação faz um envio nativo (GET com o texto do diário na URL) |
| `e2e/portal.spec.ts:57` (mesmo run, passou na 2ª) | `page.goto('/p/inicio')` "interrupted by another navigation to /p/plano" | Offline, `/p/inicio` mostra a cópia de `/p/plano` (`sw.ts`, `NetworkOnly` + `planoGuardado`); a página guardada, ao voltar a rede, navega sozinha para `/p/plano` e atropela o `goto` do teste |

### Textos novos (rascunho; revisão do dono)

| Onde | Texto |
|---|---|
| `/conta/outro-papel`, título | "Conectado com outra conta" |
| `/conta/outro-papel`, aviso | "Este aparelho está conectado como {nutricionista \| paciente \| administrador}. Saia e entre com a conta de {nutricionista \| paciente \| administrador}." |
| `/conta/outro-papel`, link | "Ir para o painel" / "Ir para o portal" / "Ir para a administração" |
| `/admin`, seção | "Verificação em duas etapas"; "Use quando alguém perdeu o app autenticador e os códigos de recuperação, ou depois da troca do AUTH_SECRET. Confirme antes a identidade de quem pediu."; campo "E-mail da conta"; botão "Reiniciar verificação em duas etapas" |
| `/admin`, confirmação | "Reiniciar a verificação em duas etapas desta conta? O app autenticador e os códigos de recuperação dela deixam de valer, as sessões abertas caem e a pessoa recebe um e-mail." |
| `/admin`, mensagens | `MSG_2FA` (T2, Passo B5) |
| E-mail `aviso_2fa_reiniciado` | Assunto "A verificação em duas etapas da sua conta foi desativada"; corpo na T2, Passo B4 |
| Manifest do painel | `name` "NutriDebby — Painel", `short_name` "Painel ND", `description` "Painel da nutricionista" |

## Review Focus

1. **O salvamento legítimo do editor continua passando** com a conferência de origem (o `fetch` do próprio app manda `Origin` igual ao `APP_URL`) — T1, Passo 1 (teste com a própria origem → 200) e Passo 6 (E2E `plano-alimentar.spec.ts` inteiro).
2. **Deploy deste próprio plano:** o worker novo sobe antes de existir a função `app_versao_do_schema()` (a `0094` roda no boot do app) — tem de esperar, não cair na hora — T2, Passo A1 (caso "função ainda não existe").
3. **E-mail digitado com maiúsculas e espaços, conta inexistente, a própria conta do admin e conta sem 2FA** no reinício: mensagem certa e nada muda no banco; e-mail que não sai (fila recusa) desfaz tudo — T2, Passo B1.
4. **`?esperado=` forjado** (`javascript:`, papel inexistente, o mesmo papel da sessão, lista) e **nada da conta na tela** do aviso de outro papel — T3, Passo 1 (página) e Passo 7 (E2E: o e-mail do paciente não aparece).
5. **App do painel instalado depois de 12 h ociosas**: o login (`/entrar`) tem de ficar dentro do escopo, e nenhum service worker pode controlar `/painel` — T5, Passo 1 (`scope` cobre `/entrar` e `/conta/seguranca`) e Passo 3 (guarda do registro do SW).

---

## Estrutura de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `src/app/api/painel/planos/[id]/route.ts` (alterar) | T1 | `mesmaOrigem` no `PUT` |
| `src/app/api/painel/planos/[id]/route.test.ts` (alterar) | T1 | recusa e aceitação da origem |
| `src/app/api/mesma-origem-rotas.test.ts` (criar) | T1 | guarda: toda rota de escrita com cookie recusa origem estranha |
| `src/lib/mesma-origem.ts` (comentário) | T1 | cita o `PUT` |
| `drizzle/0094_versao_do_schema.sql` (custom) | T2a | `app_versao_do_schema()` |
| `src/worker/versao-schema.ts` + `.test.ts` (criar) | T2a | `versaoEsperada`, `versaoAplicada`, `esperarVersaoDoSchema`, `SchemaAtrasadoError` |
| `src/worker/index.ts` (alterar) | T2a | espera antes do `boss.start()` |
| `src/db/migrate.test.ts`, `src/db/migrate-owner.test.ts` (alterar) | T2a | a função com o role da aplicação e com o migrator sem superusuário |
| `src/db/schema/platform.ts` (alterar) | T2b | tabela `adminActions` |
| `drizzle/0095_admin_actions.sql` (gerada), `drizzle/0096_admin_actions_somente_insercao.sql` (custom) | T2b | tabela e `REVOKE` |
| `src/modules/plataforma/reiniciar-2fa.ts` + `.test.ts` (criar) | T2b | `reiniciarDoisFatores`, `Reiniciar2faError`, `MSG_2FA` |
| `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts` (alterar) | T2b | e-mail `aviso_2fa_reiniciado` |
| `src/app/admin/actions.ts`, `src/app/admin/page.tsx` (alterar), `src/app/admin/reiniciar-2fa-form.tsx` (criar) | T2b | ação e formulário |
| `src/app/admin/sem-tabelas-tenant.test.ts` (alterar) | T2b | módulo novo na guarda |
| `scripts/admin-reiniciar-2fa.ts` (criar), `docker-entrypoint.sh`, `package.json` (alterar) | T2b | comando para o último admin travado |
| `CLAUDE.md` (regra 1) | T2b | arquivo novo na lista da tabela `user` |
| `docs/manual-tecnico/01-…md`, `06-…md` (alterar) | T1, T2 | divergências 3 e 12 resolvidas; §6.2.1 e §6.9.1 |
| `src/lib/session-rules.ts` + `.test.ts` (alterar) | T3 | `OUTRO_PAPEL_PATH`, `ROTULO_PAPEL`, `ehPapel`, `papelEsperado`, `caminhoOutroPapel`, `textoOutroPapel` |
| `src/lib/session.ts` + `.test.ts` (alterar) | T3 | `forbidden` → aviso |
| `src/app/conta/outro-papel/page.tsx` + `page.test.ts` (criar) | T3 | a tela do aviso |
| `src/app/painel/acoes-de-paciente.test.ts` (alterar) | T3 | destinos novos |
| `e2e/portal.spec.ts` (alterar) | T3, T4 | aviso de outro papel; corridas do diário e do offline |
| `e2e/manual.spec.ts` (alterar) | T4 | espera a gravação do tour; `retries: 0` |
| `src/app/p/(portal)/diario/diario-form.tsx` + `diario-form.test.ts` (alterar/criar) | T4 | "Registrar" só depois da hidratação |
| `scripts/e2e-seed.ts` (alterar) | T4 | zera os limites de login dos IPs do E2E (`10.9.%`) |
| `src/app/manifesto-painel.ts` + `.test.ts` (criar) | T5 | manifest e metadados do painel |
| `src/app/painel.webmanifest/route.ts` (criar) | T5 | serve o manifest do painel |
| `src/app/painel/layout.tsx` (alterar) | T5 | `metadata` do painel |
| `public/icones/painel.svg` + PNGs (criar), `scripts/gerar-icones.ts` (alterar) | T5 | ícones provisórios |
| `src/app/sw-escopo.test.ts` (criar), `src/app/sw-regras.test.ts` (alterar) | T5 | nenhum SW cobre o painel |
| `e2e/painel-pwa.spec.ts` (criar) | T5 | manifest no navegador, sem SW, `no-store` |

**IPs do E2E deste plano:** bloco **`10.9.17.x`** (livre em 06/10/2026): `10.9.17.1` (T3), `10.9.17.10` (T5).

### Contratos entre tarefas

- T3 consome nada de T1/T2. T4 edita `e2e/portal.spec.ts` depois da T3 (a T3 troca o teste "nutricionista em /p/inicio volta ao painel"): **ordem T1 → T2 → T3 → T4 → T5**, sem paralelismo.
- Nomes usados fora da própria tarefa: `OUTRO_PAPEL_PATH = '/conta/outro-papel'` (T3, `src/lib/session-rules.ts`); `MANIFESTO_DO_PAINEL_URL = '/painel.webmanifest'` (T5); `PRAZO_SCHEMA_MS`, `INTERVALO_SCHEMA_MS` (T2a; citados no manual).

---

### Task 1: Conferência de origem no salvamento do plano alimentar (P09-01; manual técnico cap. 01, divergência 12)

**Files:**
- Modify: `src/app/api/painel/planos/[id]/route.ts:21-23`
- Modify: `src/lib/mesma-origem.ts:3-7` (comentário)
- Test: `src/app/api/painel/planos/[id]/route.test.ts`
- Create: `src/app/api/mesma-origem-rotas.test.ts`
- Modify: `docs/manual-tecnico/01-visao-geral-e-arquitetura.md` (linha 452, §1.11 item 6, divergência 12)

**Interfaces:**
- Consumes: `mesmaOrigem(req: Request, appUrl?: string): boolean` (`src/lib/mesma-origem.ts`, já existe).
- Produces: a regra "rota de escrita com cookie em `src/app/api/{painel,p,documento}` confere a origem antes da sessão", presa pela guarda.

- [ ] **Step 1: Escrever o teste que falha (rota)**

Em `src/app/api/painel/planos/[id]/route.test.ts`, dentro do `describe('PUT /api/painel/planos/[id] …')`, acrescentar:

```ts
  it('P09-01: Origin de outro site (ou "null") é 403 e não grava; a própria origem salva', async () => {
    const A = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    const comOrigem = (origin: string, revisao: number) =>
      PUT(
        new Request(url(id), { method: 'PUT', body: JSON.stringify(corpo(revisao)), headers: { 'content-type': 'application/json', cookie: A.cookie, origin } }),
        { params: Promise.resolve({ id }) },
      );
    const estranha = await comOrigem('https://evil.example', 0);
    expect(estranha.status).toBe(403);
    expect(await estranha.json()).toEqual({ erro: 'Acesso negado' });
    expect((await comOrigem('null', 0)).status).toBe(403);
    const propria = await comOrigem('http://localhost:3000', 0); // APP_URL dos testes
    expect(propria.status).toBe(200);
    expect(await propria.json()).toEqual({ revisao: 1 }); // as recusas não gravaram: a revisão 0 ainda era a atual
  });
```

- [ ] **Step 2: Escrever a guarda que falha**

Criar `src/app/api/mesma-origem-rotas.test.ts`:

```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// P09-01 (manual técnico, cap. 01, divergência 12): toda rota de API que usa cookie e muda estado confere a origem
// (mesmaOrigem) ANTES da sessão. Sem cookie e com Origin de outro site, a resposta tem de ser 403 — uma rota sem a
// conferência leria a sessão e responderia 401. A lista sai do disco: rota nova sem a conferência quebra aqui.
// Fora daqui, de propósito: /api/auth (o Better Auth confere a origem), /api/n (página pública, sem cookie, Turnstile),
// /api/webhooks (assinatura), /api/csp-relatorio e /api/erro-cliente (sem sessão).
vi.mock('server-only', () => ({}));

const PASTAS = ['painel', 'p', 'documento'] as const;
const METODOS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ID = '00000000-0000-4000-8000-000000000000';
const API = join(process.cwd(), 'src/app/api');
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ROTAS = PASTAS.flatMap((pasta) =>
  readdirSync(join(API, pasta), { recursive: true, encoding: 'utf8' })
    .filter((f) => f === 'route.ts' || f.endsWith('/route.ts'))
    .map((f) => `${pasta}/${f}`),
).sort();

describe('rotas de escrita com cookie: Origin de outro site → 403 antes da sessão (S-9, P09-01)', () => {
  it('todo POST/PUT/PATCH/DELETE recusa Origin estranho com 403', async () => {
    const chamadas: string[] = [];
    for (const arquivo of ROTAS) {
      const segmentos = arquivo.split('/').slice(0, -1);
      const ehParam = (s: string) => /^\[\w+\]$/.test(s);
      const params = Object.fromEntries(segmentos.filter(ehParam).map((s) => [s.slice(1, -1), ID]));
      const url = `http://localhost:3000/api/${segmentos.map((s) => (ehParam(s) ? ID : s)).join('/')}`;
      const m = (await import(/* @vite-ignore */ join(API, arquivo))) as Record<string, unknown>;
      for (const metodo of METODOS) {
        if (typeof m[metodo] !== 'function') continue;
        chamadas.push(`${metodo} ${arquivo}`);
        const r = await (m[metodo] as Handler)(
          new Request(url, { method: metodo, body: '{}', headers: { origin: 'https://evil.example', 'content-type': 'application/json' } }),
          { params: Promise.resolve(params) },
        );
        expect(r.status, `${metodo} ${arquivo}`).toBe(403);
      }
    }
    expect(chamadas).toContain('PUT painel/planos/[id]/route.ts');
    expect(chamadas).toContain('POST p/diario/route.ts');
    expect(chamadas.length).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run 'src/app/api/painel/planos/[id]/route.test.ts' src/app/api/mesma-origem-rotas.test.ts`
Expected: FAIL — o caso novo recebe 200 em vez de 403; a guarda falha só em `PUT painel/planos/[id]/route.ts` (recebe 401). Se a guarda falhar em outra rota, ela também lê a sessão antes da origem: mover o `if (!mesmaOrigem(req))` para a primeira linha do handler dela (nunca tirar a rota da lista).

- [ ] **Step 4: Implementar**

Em `src/app/api/painel/planos/[id]/route.ts`, importar e conferir primeiro no `PUT` (o `GET` não muda estado e fica como está):

```ts
import { mesmaOrigem } from '@/lib/mesma-origem';
// …
/** US-022 "Salvamento automático" (D7). P09-01: só da própria origem (o editor manda o `fetch` do próprio app). */
export async function PUT(req: Request, { params }: RouteContext<'/api/painel/planos/[id]'>) {
  if (!mesmaOrigem(req)) return json(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  // … resto igual
```

Em `src/lib/mesma-origem.ts`, trocar a primeira frase do comentário por: `S-9 (P06-12, P09-01): rota de escrita com cookie (POST/PUT/PATCH/DELETE) só da própria origem, conferida antes da sessão (guarda em src/app/api/mesma-origem-rotas.test.ts).`

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run 'src/app/api/painel/planos/[id]/route.test.ts' src/app/api/mesma-origem-rotas.test.ts src/lib/mesma-origem.test.ts`
Expected: PASS.

- [ ] **Step 6: O editor de verdade continua salvando (Review Focus 1)**

Run: `pnpm build && pnpm e2e:seed && pnpm test:e2e e2e/plano-alimentar.spec.ts`
Expected: PASS (o salvamento automático manda `Origin: http://localhost:3100`, igual ao `APP_URL` local).

- [ ] **Step 7: Manual técnico**

Em `docs/manual-tecnico/01-visao-geral-e-arquitetura.md`: na tabela de rotas (linha 452) trocar "sem `mesmaOrigem` (exceção sem motivo no código: divergência 12)" por "`mesmaOrigem` antes da sessão (P09-01)"; no §1.11 item 6 tirar "(a única rota de escrita sem ela é o `PUT /api/painel/planos/[id]`, ver divergência 12)" e acrescentar "— guarda em `src/app/api/mesma-origem-rotas.test.ts`"; na divergência 12, coluna "Impacto", acrescentar no começo "**Resolvida no Plano 09 (P09-01).**".

- [ ] **Step 8: Commit**

```bash
git add 'src/app/api/painel/planos/[id]/route.ts' 'src/app/api/painel/planos/[id]/route.test.ts' src/app/api/mesma-origem-rotas.test.ts src/lib/mesma-origem.ts docs/manual-tecnico/01-visao-geral-e-arquitetura.md
git commit -m "fix(plano-alimentar): conferência de origem no salvamento do plano e guarda das rotas de escrita (P09-01)"
```

---

### Task 2: Worker espera a versão do schema no deploy e o admin reinicia o 2FA de uma conta (P09-02)

Duas partes independentes, na mesma tarefa (um item do backlog). Fazer **A** inteira (com commit) e depois **B**.

**Files (A — worker):**
- Create: `drizzle/0094_versao_do_schema.sql` (custom) e a entrada no `drizzle/meta/_journal.json` (gerada pelo drizzle-kit)
- Create: `src/worker/versao-schema.ts`, `src/worker/versao-schema.test.ts`
- Modify: `src/worker/index.ts:46-48` (antes do `new PgBoss`)
- Test: `src/db/migrate.test.ts`, `src/db/migrate-owner.test.ts`
- Modify: `docs/manual-tecnico/06-worker-seguranca-operacao.md` (§6.2.1), `docs/manual-tecnico/01-visao-geral-e-arquitetura.md` (divergência 3)

**Files (B — 2FA):**
- Modify: `src/db/schema/platform.ts` (tabela `adminActions`)
- Create: `drizzle/0095_admin_actions.sql` (gerada), `drizzle/0096_admin_actions_somente_insercao.sql` (custom)
- Create: `src/modules/plataforma/reiniciar-2fa.ts`, `src/modules/plataforma/reiniciar-2fa.test.ts`
- Modify: `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`
- Modify: `src/app/admin/actions.ts`, `src/app/admin/page.tsx`; Create: `src/app/admin/reiniciar-2fa-form.tsx`
- Modify: `src/app/admin/sem-tabelas-tenant.test.ts` (`ARQUIVOS_DO_ADMIN`)
- Create: `scripts/admin-reiniciar-2fa.ts`; Modify: `docker-entrypoint.sh`, `package.json`
- Modify: `CLAUDE.md` (regra 1), `docs/manual-tecnico/06-worker-seguranca-operacao.md` (§6.9.1)

**Interfaces:**
- Produces (A): `versaoEsperada(pasta?: string): { when: number; tag: string }`; `versaoAplicada(db: Db): Promise<number | null>`; `esperarVersaoDoSchema(deps): Promise<void>`; `SchemaAtrasadoError`; `PRAZO_SCHEMA_MS = 300_000`; `INTERVALO_SCHEMA_MS = 3_000`; SQL `app_versao_do_schema() RETURNS bigint`.
- Produces (B): `reiniciarDoisFatores(email: string, autor: Autor, deps?: { db?: Db; avisar?: Avisar }): Promise<{ userId: string; papel: AppRole; sessoesRevogadas: number }>`; `type Autor = { origem: 'admin'; adminId: string } | { origem: 'cli'; adminId: null }`; `Reiniciar2faError` (`codigo: 'email' | 'nao_encontrada' | 'propria' | 'sem_2fa'`); `MSG_2FA`; `reiniciar2faAction(_prev: Reiniciar2faState, formData: FormData): Promise<Reiniciar2faState>`; e-mail `{ tipo: 'aviso_2fa_reiniciado'; para: string }`.

#### Parte A — o worker espera o schema

- [ ] **Step A1: Escrever os testes que falham (lógica da espera)**

Criar `src/worker/versao-schema.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { esperarVersaoDoSchema, SchemaAtrasadoError, versaoEsperada } from './versao-schema';

const ESPERADA = { when: 1000, tag: '0096_teste' };
/** Relógio falso: `dormir` só anda o relógio (nenhum teste espera de verdade). */
function relogio() {
  let t = 0;
  return { agora: () => t, dormir: vi.fn(async (ms: number) => { t += ms; }) };
}
const erroPg = (code: string) => Object.assign(new Error('mensagem do banco que nunca vai para o log'), { code });
afterEach(() => vi.restoreAllMocks());

describe('o worker espera a versão do schema antes de registrar os consumidores (P09-02 a)', () => {
  it('versaoEsperada: a última entrada do journal do drizzle que veio com o código', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { when: number; tag: string }[] };
    const ultima = journal.entries.at(-1)!;
    expect(versaoEsperada()).toEqual({ when: ultima.when, tag: ultima.tag });
  });

  it('schema em dia (ou mais novo: worker antigo depois de um rollback) → segue na hora', async () => {
    for (const aplicada of [1000, 2000]) {
      const r = relogio();
      await esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: async () => aplicada, ...r });
      expect(r.dormir).not.toHaveBeenCalled();
    }
  });

  it('migration ainda rodando no app: confere de novo a cada intervalo e segue quando ela termina', async () => {
    const r = relogio();
    const respostas = [null, 900, 1000];
    await esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: async () => respostas.shift() ?? null, ...r, intervaloMs: 3000 });
    expect(r.dormir.mock.calls).toEqual([[3000], [3000]]);
  });

  it('Review Focus 2: a função da 0094 ainda não existe (o deploy deste plano) ou o banco caiu → espera, não derruba', async () => {
    const r = relogio();
    const erros = [erroPg('42883'), erroPg('57P01')];
    await esperarVersaoDoSchema({
      esperada: ESPERADA,
      aplicada: async () => { const e = erros.shift(); if (e) throw e; return 1000; },
      ...r,
    });
    expect(r.dormir).toHaveBeenCalledTimes(2);
  });

  it('passou do prazo → SchemaAtrasadoError; o log leva só a migration esperada, o nome do erro e o SQLSTATE', async () => {
    const r = relogio();
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await expect(
      esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: async () => { throw erroPg('42883'); }, ...r, prazoMs: 10_000, intervaloMs: 3000 }),
    ).rejects.toBeInstanceOf(SchemaAtrasadoError);
    expect(r.dormir).toHaveBeenCalledTimes(4); // 0, 3, 6 e 9 s; aos 12 s passou dos 10
    expect(erro).toHaveBeenCalledWith({ migration: '0096_teste', erro: 'Error', sqlstate: '42883' }, expect.any(String));
    expect(JSON.stringify(erro.mock.calls)).not.toContain('mensagem do banco');
  });

  it('startWorker espera o schema ANTES de subir o pg-boss (nenhum consumidor nem agendamento antes)', () => {
    const src = readFileSync('src/worker/index.ts', 'utf8');
    const espera = src.indexOf('await esperarVersaoDoSchema(');
    expect(espera).toBeGreaterThan(-1);
    expect(espera).toBeLessThan(src.indexOf('new PgBoss('));
  });
});
```

- [ ] **Step A2: Rodar e ver falhar**

Run: `pnpm vitest run src/worker/versao-schema.test.ts`
Expected: FAIL — `Cannot find module './versao-schema'`.

- [ ] **Step A3: Implementar `src/worker/versao-schema.ts`**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { logger, nomeDoErro } from '@/lib/logger';

/** P09-02 (a) / spec §9.7: quanto o worker espera o app aplicar as migrations (o heartbeat tolera 10 min). */
export const PRAZO_SCHEMA_MS = 5 * 60_000;
export const INTERVALO_SCHEMA_MS = 3_000;

export type VersaoEsperada = { when: number; tag: string };

export class SchemaAtrasadoError extends Error {
  override name = 'SchemaAtrasadoError';
}

/** A última migration do journal que veio com este código (a pasta `drizzle/` é copiada na imagem, Dockerfile). */
export function versaoEsperada(pasta: string = path.join(process.cwd(), 'drizzle')): VersaoEsperada {
  const journal = JSON.parse(readFileSync(path.join(pasta, 'meta', '_journal.json'), 'utf8')) as { entries: VersaoEsperada[] };
  const ultima = journal.entries.at(-1);
  if (!ultima) throw new Error('journal de migrations vazio');
  return { when: ultima.when, tag: ultima.tag };
}

/** O `when` da última migration aplicada, pela função da 0094 (o role da aplicação não lê o schema `drizzle`). */
export async function versaoAplicada(db: Db): Promise<number | null> {
  const r = await db.execute<{ v: string | number | null }>(sql`select app_versao_do_schema() as v`);
  const v = r.rows[0]?.v;
  return v === null || v === undefined ? null : Number(v);
}

/** SQLSTATE (5 caracteres) de um erro do Postgres — nunca a mensagem, que pode citar SQL e parâmetros (regra 3). */
const sqlstate = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) ? c : undefined;
};

/**
 * O deploy dispara app e worker juntos e as migrations rodam no boot do app (`docker-entrypoint.sh`): o worker novo pode
 * subir antes delas. Nada de consumidor antes de o banco ter, no mínimo, a última migration deste código. Erro na leitura
 * (função ainda inexistente, banco fora) conta como "ainda não". Passou do prazo: lança — o processo sai com erro e o
 * Swarm o reinicia, conferindo de novo.
 */
export async function esperarVersaoDoSchema(deps: {
  esperada: VersaoEsperada;
  aplicada: () => Promise<number | null>;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  prazoMs?: number;
  intervaloMs?: number;
}): Promise<void> {
  const agora = deps.agora ?? Date.now;
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limite = agora() + (deps.prazoMs ?? PRAZO_SCHEMA_MS);
  let esperou = false;
  for (;;) {
    let aplicada: number | null = null;
    let falha: { erro: string; sqlstate: string | undefined } | undefined;
    try {
      aplicada = await deps.aplicada();
    } catch (e) {
      falha = { erro: nomeDoErro(e), sqlstate: sqlstate(e) };
    }
    if (aplicada !== null && aplicada >= deps.esperada.when) {
      if (esperou) logger.info({ migration: deps.esperada.tag }, 'schema do banco em dia; worker seguindo');
      return;
    }
    if (agora() >= limite) {
      logger.error({ migration: deps.esperada.tag, ...falha }, 'schema do banco atrás do worker: o app não aplicou as migrations a tempo');
      throw new SchemaAtrasadoError(`schema do banco atrás do worker (esperada ${deps.esperada.tag})`);
    }
    if (!esperou) logger.warn({ migration: deps.esperada.tag, ...falha }, 'esperando o app aplicar as migrations');
    esperou = true;
    await dormir(deps.intervaloMs ?? INTERVALO_SCHEMA_MS);
  }
}
```

Observação: o teste do prazo espera o objeto exato `{ migration, erro, sqlstate }`; com `falha` indefinida (sem erro), o log leva só `{ migration }`.

- [ ] **Step A4: Ligar no worker**

Em `src/worker/index.ts`, importar `import { esperarVersaoDoSchema, versaoAplicada, versaoEsperada } from './versao-schema';` e, logo depois do `iniciarSentry(…)` e **antes** do `new PgBoss(`:

```ts
  // P09-02 (a) / spec §9.7: o deploy sobe app e worker juntos e as migrations rodam no boot do app. Nenhum consumidor nem
  // agendamento antes de o banco ter a última migration deste código (espera até PRAZO_SCHEMA_MS; depois sai com erro).
  await esperarVersaoDoSchema({ esperada: versaoEsperada(), aplicada: () => versaoAplicada(getDb()) });
```

- [ ] **Step A5: Rodar e ver passar a lógica**

Run: `pnpm vitest run src/worker/versao-schema.test.ts`
Expected: PASS.

- [ ] **Step A6: Migration `0094` (custom) e testes que falham no banco**

Run: `pnpm drizzle-kit generate --custom --name versao_do_schema`
Expected: cria `drizzle/0094_versao_do_schema.sql` (vazio) e a entrada no journal.

Em `src/db/migrate.test.ts`, acrescentar (o arquivo já importa `readFileSync`):

```ts
  it('P09-02 (a): o role da aplicação lê a versão do schema só pela função (= `when` da última migration do journal), nunca a tabela do drizzle', async () => {
    const journal = JSON.parse(readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { when: number }[] };
    const { rows } = await app.pool.query('select app_versao_do_schema() as v');
    expect(Number(rows[0].v)).toBe(journal.entries.at(-1)!.when);
    const { versaoAplicada } = await import('@/worker/versao-schema');
    expect(await versaoAplicada(app.db)).toBe(journal.entries.at(-1)!.when);
    await expect(app.pool.query('select count(*) from drizzle.__drizzle_migrations')).rejects.toMatchObject({ code: '42501' });
  });
```

Em `src/db/migrate-owner.test.ts`, dentro do `describe` principal:

```ts
  it('P09-02 (a): app_versao_do_schema() funciona com o migrator sem superusuário (dono do schema drizzle)', async () => {
    const { rows } = await app.query('select app_versao_do_schema() as v');
    const { rows: dono } = await owner.query('select max(created_at)::bigint as v from drizzle.__drizzle_migrations');
    expect(Number(rows[0].v)).toBe(Number(dono[0].v));
  });
```

Run: `pnpm vitest run src/db/migrate.test.ts src/db/migrate-owner.test.ts`
Expected: FAIL — `function app_versao_do_schema() does not exist`.

- [ ] **Step A7: Escrever a `0094`**

`drizzle/0094_versao_do_schema.sql`:

```sql
-- P09-02 (a) / spec §9.7: o worker confere, antes de registrar os consumidores, que a última migration do journal que veio
-- com o código dele já foi aplicada (o deploy sobe app e worker juntos; as migrations rodam no boot do app). O role da
-- aplicação não lê o schema `drizzle` (dono: o migrator); esta função devolve só o `created_at` da última aplicada, que o
-- drizzle grava com o `when` do journal. search_path fixo e nome qualificado (mesmo endurecimento da 0012).
CREATE OR REPLACE FUNCTION app_versao_do_schema() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT max(created_at)::bigint FROM drizzle.__drizzle_migrations $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_versao_do_schema() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_versao_do_schema() TO nutri_app_role;
```

Run: `pnpm vitest run src/db/migrate.test.ts src/db/migrate-owner.test.ts src/worker/versao-schema.test.ts`
Expected: PASS (o Testcontainers aplica as migrations com o role dono; nada no banco de dev compartilhado).

- [ ] **Step A8: Manual técnico (parte A)**

`docs/manual-tecnico/06-worker-seguranca-operacao.md`, §6.2.1: acrescentar um parágrafo "**Espera do schema (P09-02).** Antes de subir o pg-boss, `esperarVersaoDoSchema` (`src/worker/versao-schema.ts`) confere pela função `app_versao_do_schema()` (0094) que a última migration do `drizzle/meta/_journal.json` da imagem já foi aplicada pelo app; confere de novo a cada 3 s por até 5 min. Passou do prazo: log `schema do banco atrás do worker`, o processo sai com erro e o Swarm o reinicia. Em dev, `pnpm worker` num banco sem as migrations do branch espera e sai com a mesma mensagem: rode `pnpm db:migrate`." Em `01-…md`, divergência 3, coluna "Impacto": começar com "**Resolvida no Plano 09 (P09-02 a).**".

- [ ] **Step A9: Commit**

```bash
git add drizzle/0094_versao_do_schema.sql drizzle/meta/_journal.json drizzle/meta/0094_snapshot.json src/worker/versao-schema.ts src/worker/versao-schema.test.ts src/worker/index.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts docs/manual-tecnico/06-worker-seguranca-operacao.md docs/manual-tecnico/01-visao-geral-e-arquitetura.md
git commit -m "feat(worker): espera a versão do schema antes de registrar os consumidores (P09-02 a)"
```

(Se o drizzle-kit não gerar `0094_snapshot.json` para a migration custom, tirar o caminho do `git add`.)

#### Parte B — o admin reinicia o 2FA de uma conta

- [ ] **Step B1: Escrever os testes que falham (módulo)**

Criar `src/modules/plataforma/reiniciar-2fa.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { adminActions, session, twoFactor, user } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { criarEEntrar, entrar } from '../../../test/sessao';
import { MSG_2FA, Reiniciar2faError, reiniciarDoisFatores, type Codigo2fa } from './reiniciar-2fa';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

/** Conta com 2FA "ativo" no banco (a linha de two_factor com segredo qualquer: o que importa aqui é ela sumir). */
async function comDoisFatores(appRole: 'admin' | 'nutri') {
  const c = await criarEEntrar(db, auth, { appRole });
  await entrar(auth, c.email); // segunda sessão
  await db.insert(twoFactor).values({ userId: c.id, secret: 'cifrado-qualquer', backupCodes: 'cifrado-qualquer' });
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, c.id));
  return c;
}
const avisos = () => vi.fn(async () => 'job');

describe('reiniciarDoisFatores (P09-02 b, manual técnico §6.9.1)', () => {
  it('apaga o two_factor, desliga o 2FA, revoga as sessões, registra em admin_actions e avisa a conta — e o login volta a funcionar sem código', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const alvo = await comDoisFatores('nutri');
    const avisar = avisos();
    const r = await reiniciarDoisFatores(`  ${alvo.email.toUpperCase()} `, { origem: 'admin', adminId: admin.id }, { db, avisar });
    expect(r).toEqual({ userId: alvo.id, papel: 'nutri', sessoesRevogadas: 2 });
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toEqual([]);
    expect((await db.select({ v: user.twoFactorEnabled }).from(user).where(eq(user.id, alvo.id)))[0].v).toBe(false);
    expect(await db.select().from(session).where(eq(session.userId, alvo.id))).toEqual([]);
    const [reg] = await db.select().from(adminActions).where(eq(adminActions.alvoUserId, alvo.id));
    expect(reg).toMatchObject({ adminUserId: admin.id, acao: 'reiniciar_2fa', alvoPapel: 'nutri', origem: 'admin' });
    expect(avisar).toHaveBeenCalledWith({ tipo: 'aviso_2fa_reiniciado', para: alvo.email }, expect.anything());
    await expect(entrar(auth, alvo.email)).resolves.toMatch(/^nd\.session_token=/); // sem twoFactorRedirect
  });

  it('Review Focus 3: conta inexistente, a própria conta, conta sem 2FA e e-mail vazio → erro com a mensagem e nada muda', async () => {
    const admin = await comDoisFatores('admin');
    const sem = await criarEEntrar(db, auth, { appRole: 'nutri' });
    const autor = { origem: 'admin' as const, adminId: admin.id };
    const avisar = avisos();
    const casos: [string, Codigo2fa, string][] = [
      [`ninguem-${randomUUID()}@teste.dev`, 'nao_encontrada', MSG_2FA.naoEncontrada],
      [admin.email, 'propria', MSG_2FA.propria],
      [sem.email, 'sem_2fa', MSG_2FA.semDoisFatores],
      ['   ', 'email', MSG_2FA.email],
    ];
    for (const [email, codigo, mensagem] of casos) {
      const erro = await reiniciarDoisFatores(email, autor, { db, avisar }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(Reiniciar2faError);
      expect(erro).toMatchObject({ codigo, message: mensagem });
    }
    expect(avisar).not.toHaveBeenCalled();
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, admin.id))).toHaveLength(1);
    expect(await db.select().from(adminActions).where(eq(adminActions.alvoUserId, admin.id))).toEqual([]);
  });

  it('o e-mail não entra na fila → nada muda (mesma transação)', async () => {
    const alvo = await comDoisFatores('nutri');
    const falha = vi.fn(async () => { throw new Error('A fila de e-mail recusou o envio'); });
    await expect(reiniciarDoisFatores(alvo.email, { origem: 'cli', adminId: null }, { db, avisar: falha })).rejects.toThrow('recusou');
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toHaveLength(1);
    expect(await db.select().from(session).where(eq(session.userId, alvo.id))).toHaveLength(2);
  });

  it('pelo comando no servidor (último admin travado): origem cli, sem admin, e o admin alvo é reiniciado', async () => {
    const alvo = await comDoisFatores('admin');
    const r = await reiniciarDoisFatores(alvo.email, { origem: 'cli', adminId: null }, { db, avisar: avisos() });
    expect(r.papel).toBe('admin');
    const [reg] = await db.select().from(adminActions).where(eq(adminActions.alvoUserId, alvo.id));
    expect(reg).toMatchObject({ adminUserId: null, origem: 'cli' });
  });
});
```

Run: `pnpm vitest run src/modules/plataforma/reiniciar-2fa.test.ts`
Expected: FAIL — módulo e `adminActions` não existem.

- [ ] **Step B2: Tabela `admin_actions` (schema + 0095 gerada + 0096 custom)**

Em `src/db/schema/platform.ts`, depois de `backupRuns`:

```ts
/**
 * P09-02 (b): ações sensíveis do admin sobre contas — hoje só o reinício do 2FA. Sem tenant_id (fora da RLS; o admin não
 * toca tabela 🔒). Para a aplicação, só INSERT e SELECT (0096). Sem e-mail: a conta é o id e o papel.
 */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Nulo quando veio do comando no servidor (`admin:reiniciar-2fa`, sem sessão). */
    adminUserId: uuid('admin_user_id'),
    acao: text('acao').notNull(),
    alvoUserId: uuid('alvo_user_id').notNull(),
    alvoPapel: text('alvo_papel').notNull(),
    origem: text('origem').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('admin_actions_acao_valida', sql`${t.acao} in ('reiniciar_2fa')`),
    check('admin_actions_origem_valida', sql`${t.origem} in ('admin', 'cli')`),
    check('admin_actions_autor_coerente', sql`(${t.origem} = 'cli') = (${t.adminUserId} is null)`),
  ],
);
```

Run: `pnpm db:generate` → confere que gerou `drizzle/0095_admin_actions.sql` só com o `CREATE TABLE "admin_actions"` e os CHECKs (renomear o arquivo e o `tag` no journal para `0095_admin_actions` se o nome sair diferente).
Run: `pnpm drizzle-kit generate --custom --name admin_actions_somente_insercao` e escrever:

```sql
-- P09-02 (b): registro do admin é só de inclusão para a aplicação (como audit_log, 0002, e consents, 0009)
REVOKE UPDATE, DELETE, TRUNCATE ON admin_actions FROM nutri_app_role;
```

Acrescentar em `src/db/migrate.test.ts`:

```ts
  it('P09-02 (b): admin_actions é só de inclusão para a aplicação', async () => {
    const { rows } = await app.pool.query(
      `select has_table_privilege('nutri_app', 'admin_actions', 'INSERT') as i, has_table_privilege('nutri_app', 'admin_actions', 'UPDATE') as u, has_table_privilege('nutri_app', 'admin_actions', 'DELETE') as d`,
    );
    expect(rows[0]).toEqual({ i: true, u: false, d: false });
  });
```

- [ ] **Step B3: Implementar `src/modules/plataforma/reiniciar-2fa.ts`**

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { adminActions, session, twoFactor, user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import type { EmailMessage } from '@/email/types';
import { logger } from '@/lib/logger';
import type { AppRole } from '@/lib/session-rules';

export const MSG_2FA = {
  email: 'Informe o e-mail da conta.',
  naoEncontrada: 'Nenhuma conta com este e-mail.',
  propria: 'Não é possível reiniciar a verificação em duas etapas da sua própria conta por aqui.',
  semDoisFatores: 'Esta conta não tem a verificação em duas etapas ativa.',
  ok: 'Verificação em duas etapas reiniciada. As sessões da conta foram encerradas e ela recebeu um e-mail. A pessoa pode ativar de novo em Conta > Segurança.',
  okAdmin: 'Verificação em duas etapas reiniciada. As sessões da conta foram encerradas e ela recebeu um e-mail. No próximo login, a configuração será obrigatória.',
} as const;

export type Codigo2fa = 'email' | 'nao_encontrada' | 'propria' | 'sem_2fa';
const MENSAGEM: Record<Codigo2fa, string> = {
  email: MSG_2FA.email,
  nao_encontrada: MSG_2FA.naoEncontrada,
  propria: MSG_2FA.propria,
  sem_2fa: MSG_2FA.semDoisFatores,
};

export class Reiniciar2faError extends Error {
  override name = 'Reiniciar2faError';
  constructor(readonly codigo: Codigo2fa) {
    super(MENSAGEM[codigo]);
  }
}

export type Autor = { origem: 'admin'; adminId: string } | { origem: 'cli'; adminId: null };
type Avisar = (msg: EmailMessage, tx: Tx) => Promise<unknown>;
/** tenantId nulo: o aviso de segurança sai mesmo com o consultório suspenso (o job ignora e-mail de tenant suspenso). */
const avisarPorEmail: Avisar = (msg, tx) => enqueueEmail(msg, { tx });

/**
 * P09-02 (b) / manual técnico §6.9.1: trocar o AUTH_SECRET deixa quem tem 2FA sem entrar (o segredo do TOTP e os códigos
 * de recuperação são cifrados com ele). Numa transação: trava a conta, apaga a linha de `two_factor`, desliga
 * `two_factor_enabled`, revoga as sessões, registra em `admin_actions` e enfileira o aviso à própria conta. A tabela
 * `user` é exceção de RLS (CLAUDE.md regra 1: este arquivo está na lista).
 */
export async function reiniciarDoisFatores(
  emailInformado: string,
  autor: Autor,
  deps: { db?: Db; avisar?: Avisar } = {},
): Promise<{ userId: string; papel: AppRole; sessoesRevogadas: number }> {
  const email = emailInformado.trim();
  if (!email || email.length > 254) throw new Reiniciar2faError('email');
  const db = deps.db ?? getDb();
  const avisar = deps.avisar ?? avisarPorEmail;
  const r = await db.transaction(async (tx) => {
    // `email` é citext: a busca não depende de maiúsculas
    const [alvo] = await tx
      .select({ id: user.id, email: user.email, papel: user.appRole, ativo: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.email, email))
      .for('update');
    if (!alvo) throw new Reiniciar2faError('nao_encontrada');
    if (autor.origem === 'admin' && alvo.id === autor.adminId) throw new Reiniciar2faError('propria');
    const apagados = await tx.delete(twoFactor).where(eq(twoFactor.userId, alvo.id)).returning({ id: twoFactor.id });
    if (!alvo.ativo && apagados.length === 0) throw new Reiniciar2faError('sem_2fa');
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, alvo.id));
    const sessoes = await tx.delete(session).where(eq(session.userId, alvo.id)).returning({ id: session.id });
    await tx.insert(adminActions).values({ adminUserId: autor.adminId, acao: 'reiniciar_2fa', alvoUserId: alvo.id, alvoPapel: alvo.papel, origem: autor.origem });
    await avisar({ tipo: 'aviso_2fa_reiniciado', para: alvo.email }, tx);
    return { userId: alvo.id, papel: alvo.papel as AppRole, sessoesRevogadas: sessoes.length };
  });
  // regra 3: só ids e o papel; nunca o e-mail
  logger.info({ adminId: autor.adminId, origem: autor.origem, alvoUserId: r.userId, papel: r.papel, sessoesRevogadas: r.sessoesRevogadas }, 'verificação em duas etapas reiniciada');
  return r;
}
```

- [ ] **Step B4: E-mail `aviso_2fa_reiniciado`**

Teste primeiro, em `src/email/render.test.ts`:

```ts
  it('aviso de 2FA reiniciado (P09-02 b): diz o que aconteceu, onde reativar e o que fazer se não foi pedido; sem link', () => {
    const r = renderEmail({ tipo: 'aviso_2fa_reiniciado', para: 'a@b.dev' });
    expect(r.subject).toBe('A verificação em duas etapas da sua conta foi desativada');
    expect(r.text).toContain('Conta > Segurança');
    expect(r.text).toContain('Se você não pediu isso');
    expect(r.html).not.toContain('href=');
  });
```

Em `src/email/types.ts`, acrescentar ao union `EmailMessage`:

```ts
  /** P09-02 (b): o admin (ou o comando no servidor) reiniciou o 2FA da conta; sem link (aviso de segurança). */
  | { tipo: 'aviso_2fa_reiniciado'; para: string }
```

Em `src/email/templates.tsx`, no `switch` de `renderEmail`:

```ts
    case 'aviso_2fa_reiniciado':
      return simples('A verificação em duas etapas da sua conta foi desativada', [
        'A verificação em duas etapas da sua conta no NutriDebby foi desativada pelo suporte, e as sessões abertas foram encerradas.',
        'Na próxima entrada, ative de novo em Conta > Segurança (para a administração, a ativação é obrigatória).',
        'Se você não pediu isso, fale com o suporte agora.',
      ]);
```

Run: `pnpm vitest run src/email/render.test.ts src/modules/plataforma/reiniciar-2fa.test.ts src/db/migrate.test.ts`
Expected: PASS.

- [ ] **Step B5: Ação e formulário no `/admin`**

Em `src/app/admin/actions.ts`:

```ts
import { Reiniciar2faError, MSG_2FA, reiniciarDoisFatores } from '@/modules/plataforma/reiniciar-2fa';
// …
export type Reiniciar2faState = { erro?: string; ok?: string; valor?: string };

/** P09-02 (b): reinicia o 2FA de outra conta (a confirmação fica no botão). */
export async function reiniciar2faAction(_prev: Reiniciar2faState, formData: FormData): Promise<Reiniciar2faState> {
  const { user } = await requireUser(['admin'], '/admin');
  const email = campo(formData, 'email');
  try {
    const r = await reiniciarDoisFatores(email, { origem: 'admin', adminId: user.id });
    return { ok: r.papel === 'admin' ? MSG_2FA.okAdmin : MSG_2FA.ok };
  } catch (e) {
    if (e instanceof Reiniciar2faError) return { erro: e.message, valor: email };
    throw e;
  }
}
```

Criar `src/app/admin/reiniciar-2fa-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { reiniciar2faAction, type Reiniciar2faState } from './actions';

const CONFIRMAR = 'Reiniciar a verificação em duas etapas desta conta? O app autenticador e os códigos de recuperação dela deixam de valer, as sessões abertas caem e a pessoa recebe um e-mail.';

export function Reiniciar2faForm() {
  const [state, action, pendente] = useActionState<Reiniciar2faState, FormData>(reiniciar2faAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="email-2fa" className="block text-sm font-medium">E-mail da conta</label>
        <input id="email-2fa" name="email" type="email" autoComplete="off" required defaultValue={state.valor} key={state.ok ?? state.valor}
          aria-invalid={state.erro ? true : undefined} aria-describedby={state.erro ? 'email-2fa-erro' : undefined}
          className="min-h-11 w-72 rounded border p-2" />
      </div>
      <fieldset disabled={pendente} className="contents">
        <ConfirmarBotao mensagem={CONFIRMAR}>Reiniciar verificação em duas etapas</ConfirmarBotao>
      </fieldset>
      {state.erro && <p id="email-2fa-erro" role="alert" className="w-full text-red-700">{state.erro}</p>}
      {state.ok && <p role="status" className="w-full">{state.ok}</p>}
    </form>
  );
}
```

Em `src/app/admin/page.tsx`, importar `Reiniciar2faForm` e, logo depois de `<PainelInfra />`:

```tsx
      <section aria-labelledby="titulo-2fa" className="space-y-2 rounded border p-4">
        <h2 id="titulo-2fa" className="text-lg font-semibold">Verificação em duas etapas</h2>
        <p className="text-sm">Use quando alguém perdeu o app autenticador e os códigos de recuperação, ou depois da troca do AUTH_SECRET. Confirme antes a identidade de quem pediu.</p>
        <Reiniciar2faForm />
      </section>
```

Em `src/app/admin/sem-tabelas-tenant.test.ts`, acrescentar `path.resolve('src/modules/plataforma/reiniciar-2fa.ts'),` a `ARQUIVOS_DO_ADMIN`.

Run: `pnpm vitest run src/app/admin src/app/painel/acoes-de-paciente.test.ts`
Expected: PASS (a ação nova também redireciona paciente e nutricionista: `requireUser(['admin'])` na primeira linha).

- [ ] **Step B6: Comando para o último admin travado**

Criar `scripts/admin-reiniciar-2fa.ts`:

```ts
import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { Reiniciar2faError, reiniciarDoisFatores } from '@/modules/plataforma/reiniciar-2fa';

// P09-02 (b) / manual técnico §6.9.1: quando nenhum admin consegue entrar (troca do AUTH_SECRET). Mexe no banco em que
// roda: em produção, só o dono, com OK explícito e snapshot no hPanel antes (regras 3 e 5 do servidor).
const email = process.argv[2];
if (!email) {
  console.error('Uso: pnpm admin:reiniciar-2fa <email>');
  process.exit(1);
}
try {
  const r = await reiniciarDoisFatores(email, { origem: 'cli', adminId: null });
  console.log(`Verificação em duas etapas reiniciada; ${r.sessoesRevogadas} sessão(ões) encerrada(s).`);
  console.log(r.papel === 'admin' ? 'No próximo login, a configuração será obrigatória.' : 'A pessoa pode ativar de novo em Conta > Segurança.');
} catch (e) {
  console.error(e instanceof Reiniciar2faError ? e.message : 'Erro inesperado ao reiniciar a verificação em duas etapas');
  process.exitCode = 1;
} finally {
  await stopBoss();
  await closeDb();
}
```

`package.json`, em `scripts`: `"admin:reiniciar-2fa": "tsx --env-file-if-exists=.env.local scripts/admin-reiniciar-2fa.ts",`.
`docker-entrypoint.sh`, novo caso depois de `admin:criar)`:

```sh
  admin:reiniciar-2fa)
    exec env -u DATABASE_URL_MIGRATOR node --import tsx scripts/admin-reiniciar-2fa.ts "$@"
    ;;
```

Conferir no banco de **dev** (não produção): `pnpm admin:reiniciar-2fa ninguem@nutridebby.test` → "Nenhuma conta com este e-mail." e código de saída 1.

- [ ] **Step B7: CLAUDE.md regra 1 e manual**

`CLAUDE.md`, regra 1: na lista de quem acessa a tabela `user` fora de `withTenant`, depois de "por `src/modules/plataforma/suspensao.ts` (revogação das sessões das usuárias do tenant suspenso, US-004),", acrescentar "por `src/modules/plataforma/reiniciar-2fa.ts` (o admin, ou o comando `admin:reiniciar-2fa`, reinicia o 2FA de uma conta: apaga a linha de `two_factor`, desliga `two_factor_enabled`, revoga as sessões e registra em `admin_actions`, P09-02),".

`docs/manual-tecnico/06-worker-seguranca-operacao.md`, §6.9.1, "Plano para o 2FA ao trocar `AUTH_SECRET`": trocar "Não há no código rota para reiniciar o 2FA de outra conta." e o item "Se não der (vazamento ativo)…" por: "Depois da troca, um admin que ainda entra reinicia o 2FA das contas travadas em **/admin › Verificação em duas etapas** (P09-02: apaga a linha de `two_factor`, desliga o 2FA, revoga as sessões, registra em `admin_actions` e avisa a conta por e-mail). Se nenhum admin consegue entrar, o dono roda, com OK explícito e snapshot no hPanel antes, `docker exec -it <container do nutri_app> /app/docker-entrypoint.sh admin:reiniciar-2fa <email do admin>` (o container não tem `DATABASE_URL_MIGRATOR`; nunca por subagente)."

- [ ] **Step B8: Rodar tudo e commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/db/schema/platform.ts drizzle/0095_admin_actions.sql drizzle/0096_admin_actions_somente_insercao.sql drizzle/meta src/modules/plataforma/reiniciar-2fa.ts src/modules/plataforma/reiniciar-2fa.test.ts src/email/types.ts src/email/templates.tsx src/email/render.test.ts src/app/admin/actions.ts src/app/admin/page.tsx src/app/admin/reiniciar-2fa-form.tsx src/app/admin/sem-tabelas-tenant.test.ts scripts/admin-reiniciar-2fa.ts docker-entrypoint.sh package.json CLAUDE.md docs/manual-tecnico/06-worker-seguranca-operacao.md src/db/migrate.test.ts
git commit -m "feat(admin): reiniciar o 2FA de uma conta, com registro em admin_actions e aviso por e-mail (P09-02 b)"
```

---

### Task 3: Aviso claro quando o aparelho está conectado com outro papel (P09-03)

**Files:**
- Modify: `src/lib/session-rules.ts`, `src/lib/session-rules.test.ts`
- Modify: `src/lib/session.ts:83-84`, `src/lib/session.test.ts`
- Create: `src/app/conta/outro-papel/page.tsx`, `src/app/conta/outro-papel/page.test.ts`
- Modify: `src/app/painel/acoes-de-paciente.test.ts:40-80`
- Modify: `e2e/portal.spec.ts:40-43`

**Interfaces:**
- Consumes: `homeFor`, `AppRole` (`src/lib/session-rules.ts`); `SairPortal` (`src/app/p/sair-portal.tsx`); `BotaoSair` (`src/components/botao-sair.tsx`); `ehTema` (`src/modules/plataforma/preferencias-tipos.ts`).
- Produces: `OUTRO_PAPEL_PATH = '/conta/outro-papel'`; `ROTULO_PAPEL: Record<AppRole, string>`; `ehPapel(v: unknown): v is AppRole`; `papelEsperado(allowed: readonly AppRole[]): AppRole`; `caminhoOutroPapel(allowed: readonly AppRole[]): string`; `textoOutroPapel(atual: AppRole, esperado: AppRole): string`.

- [ ] **Step 1: Escrever os testes que falham (regras e página)**

Em `src/lib/session-rules.test.ts`:

```ts
import { caminhoOutroPapel, ehPapel, OUTRO_PAPEL_PATH, papelEsperado, textoOutroPapel } from './session-rules';

describe('outro papel no aparelho (P09-03)', () => {
  it('o papel esperado é o da tela: só paciente → paciente; só admin → admin; equipe (admin e nutri) → nutricionista', () => {
    expect(papelEsperado(['paciente'])).toBe('paciente');
    expect(papelEsperado(['admin'])).toBe('admin');
    expect(papelEsperado(['nutri'])).toBe('nutri');
    expect(papelEsperado(['admin', 'nutri'])).toBe('nutri');
    expect(caminhoOutroPapel(['paciente'])).toBe(`${OUTRO_PAPEL_PATH}?esperado=paciente`);
  });
  it('o texto da tela', () => {
    expect(textoOutroPapel('nutri', 'paciente')).toBe('Este aparelho está conectado como nutricionista. Saia e entre com a conta de paciente.');
    expect(textoOutroPapel('paciente', 'admin')).toBe('Este aparelho está conectado como paciente. Saia e entre com a conta de administrador.');
  });
  it('ehPapel só aceita os três papéis', () => {
    for (const v of ['admin', 'nutri', 'paciente']) expect(ehPapel(v)).toBe(true);
    for (const v of ['javascript:alert(1)', 'Nutri', '', undefined, ['nutri'], 'root']) expect(ehPapel(v)).toBe(false);
  });
});
```

Em `src/lib/session.test.ts`, depois do `describe('conta suspensa (RN-15)')`:

```ts
describe('papel errado (P09-03)', () => {
  it('nutricionista no portal e no admin, paciente no painel → aviso de outro papel com o papel esperado; nunca a home calada', async () => {
    const [t] = await db.insert(tenants).values({ slug: `pap-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Pap' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    expect(await redirectDe(requireComo(n.cookie, ['paciente'], '/p/inicio'))).toBe('/conta/outro-papel?esperado=paciente');
    expect(await redirectDe(requireComo(n.cookie, ['admin'], '/admin'))).toBe('/conta/outro-papel?esperado=admin');
    const p = await criarEEntrar(db, auth, { appRole: 'paciente', tenantId: t.id });
    expect(await redirectDe(requireComo(p.cookie, ['nutri'], '/painel'))).toBe('/conta/outro-papel?esperado=nutri');
  });
});
```

Criar `src/app/conta/outro-papel/page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// P09-03: a tela do aviso. requireUser e os botões de sair simulados (a regra do redirect está em session.test.ts).
const usuario = vi.hoisted(() => ({ atual: { appRole: 'nutri', tema: 'escuro', name: 'Débora Nutri', email: 'debora@consultorio.dev' } as Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ requireUser: vi.fn(async () => ({ user: usuario.atual })) }));
vi.mock('@/components/botao-sair', () => ({ BotaoSair: () => '[BotaoSair]' }));
vi.mock('@/app/p/sair-portal', () => ({ SairPortal: () => '[SairPortal]' }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); } }));
const { default: OutroPapelPage } = await import('./page');

const pagina = async (esperado: unknown) => renderToStaticMarkup(await OutroPapelPage({ searchParams: Promise.resolve({ esperado }) } as never));

describe('/conta/outro-papel (P09-03)', () => {
  it('nutricionista no portal: o texto, o BotaoSair e o link do painel; nada da conta na tela', async () => {
    usuario.atual = { appRole: 'nutri', tema: 'escuro', name: 'Débora Nutri', email: 'debora@consultorio.dev' };
    const html = await pagina('paciente');
    expect(html).toContain('Este aparelho está conectado como nutricionista. Saia e entre com a conta de paciente.');
    expect(html).toContain('role="status"');
    expect(html).toContain('[BotaoSair]');
    expect(html).toContain('href="/painel"');
    expect(html).toContain('data-tema="escuro"');
    expect(html).not.toContain('Débora');
    expect(html).not.toContain('debora@consultorio.dev');
  });
  it('paciente no painel: o SairPortal (limpa o aparelho), nunca o BotaoSair', async () => {
    usuario.atual = { appRole: 'paciente', tema: 'sistema', name: 'Paula', email: 'paula@x.dev' };
    const html = await pagina('nutri');
    expect(html).toContain('Este aparelho está conectado como paciente. Saia e entre com a conta de nutricionista.');
    expect(html).toContain('[SairPortal]');
    expect(html).not.toContain('[BotaoSair]');
    expect(html).toContain('href="/p/inicio"');
  });
  it('Review Focus 4: esperado forjado, lista ou igual ao papel atual → home do papel, sem ecoar nada', async () => {
    usuario.atual = { appRole: 'nutri', tema: 'claro', name: 'N', email: 'n@x.dev' };
    for (const v of ['javascript:alert(1)', 'root', ['paciente', 'admin'], undefined, 'nutri']) {
      await expect(pagina(v)).rejects.toThrow(/^redirect \/painel$/);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/session-rules.test.ts src/lib/session.test.ts src/app/conta/outro-papel/page.test.ts`
Expected: FAIL — funções e página não existem; o `requireUser` ainda redireciona para `/p/inicio`, `/painel` ou `/admin`.

- [ ] **Step 3: Implementar as regras**

Em `src/lib/session-rules.ts`, depois de `homeFor`:

```ts
/** P09-03: tela "este aparelho está conectado com outra conta" (o caso `forbidden` de requireUser). */
export const OUTRO_PAPEL_PATH = '/conta/outro-papel';
export const ROTULO_PAPEL: Record<AppRole, string> = { admin: 'administrador', nutri: 'nutricionista', paciente: 'paciente' };

export function ehPapel(v: unknown): v is AppRole {
  return v === 'admin' || v === 'nutri' || v === 'paciente';
}

/** O papel que a tela pedia. A Segurança aceita admin e nutricionista: o aviso pede a conta de nutricionista. */
export function papelEsperado(allowed: readonly AppRole[]): AppRole {
  return allowed.includes('nutri') ? 'nutri' : allowed[0];
}

export function caminhoOutroPapel(allowed: readonly AppRole[]): string {
  return `${OUTRO_PAPEL_PATH}?esperado=${papelEsperado(allowed)}`;
}

export function textoOutroPapel(atual: AppRole, esperado: AppRole): string {
  return `Este aparelho está conectado como ${ROTULO_PAPEL[atual]}. Saia e entre com a conta de ${ROTULO_PAPEL[esperado]}.`;
}
```

Em `src/lib/session.ts`, importar `caminhoOutroPapel` (e tirar `homeFor` do import, se ficar sem uso) e trocar o caso:

```ts
    case 'forbidden':
      // P09-03: nada de redirect calado para a home do papel — a tela diz com qual conta o aparelho está
      redirect(caminhoOutroPapel(allowed));
```

- [ ] **Step 4: Implementar a página**

Antes, ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (props `searchParams` assíncronas, `PageProps`). Criar `src/app/conta/outro-papel/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SairPortal } from '@/app/p/sair-portal';
import { BotaoSair } from '@/components/botao-sair';
import { requireUser } from '@/lib/session';
import { ehPapel, homeFor, OUTRO_PAPEL_PATH, textoOutroPapel, type AppRole } from '@/lib/session-rules';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';

export const metadata: Metadata = { title: 'Conectado com outra conta' };
export const dynamic = 'force-dynamic';

const VOLTAR: Record<AppRole, string> = { admin: 'Ir para a administração', nutri: 'Ir para o painel', paciente: 'Ir para o portal' };

/**
 * P09-03: quem abre uma tela de outro papel (a nutricionista no portal, o paciente no painel, a nutricionista no admin)
 * chega aqui em vez de cair calado na própria home. Só os rótulos dos papéis: nada da conta (nome, e-mail) na tela.
 * `/conta` é protegido no proxy; o `esperado` só vale se for um dos papéis e diferente do atual.
 */
export default async function OutroPapelPage({ searchParams }: PageProps<'/conta/outro-papel'>) {
  const { user } = await requireUser(['admin', 'nutri', 'paciente'], OUTRO_PAPEL_PATH);
  const atual = user.appRole as AppRole;
  const { esperado } = await searchParams;
  if (!ehPapel(esperado) || esperado === atual) redirect(homeFor(atual));
  // como a Segurança: a nutricionista com o tema da conta, o admin no claro; o paciente segue o aparelho
  const tema = atual === 'nutri' ? (ehTema(user.tema) ? user.tema : 'sistema') : atual === 'admin' ? 'claro' : 'sistema';
  return (
    <div data-tema={tema} className="min-h-dvh bg-fundo font-sans text-texto">
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="font-titulo text-2xl font-semibold">Conectado com outra conta</h1>
        <p role="status">{textoOutroPapel(atual, esperado)}</p>
        {/* o paciente sai pelo SairPortal (S-3): cancela o push e apaga a cópia do plano do aparelho */}
        {atual === 'paciente' ? <SairPortal /> : <BotaoSair />}
        <p>
          <a href={homeFor(atual)} className="inline-flex min-h-11 items-center text-link underline">{VOLTAR[atual]}</a>
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Atualizar a guarda das Server Actions**

Em `src/app/painel/acoes-de-paciente.test.ts`: escapar o destino no `RegExp` (o `?` da query) e trocar as expectativas.

```ts
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// em todasRedirecionam:
      await expect((fn as (...a: unknown[]) => Promise<unknown>)(...args), `${caminho}#${nome}`).rejects.toThrow(new RegExp(`^redirect ${escapar(destino)}$`));
```

```ts
  it('todas levam ao aviso de outro papel (P09-03), sem erro', async () => {
    const T = await novoTenant(db);
    const { email } = await pacienteComConta(db, T);
    const cookie = await entrar(getAuth(), email);
    const painel = await todasRedirecionam(PAINEL, cookie, '/conta/outro-papel?esperado=nutri');
    const admin = await todasRedirecionam(ADMIN, cookie, '/conta/outro-papel?esperado=admin');
    expect(painel.length).toBeGreaterThanOrEqual(40);
    expect(admin.length).toBeGreaterThanOrEqual(5);
  });
```

```ts
  it('todas levam ao aviso de outro papel (P09-03), sem erro', async () => {
    const n = await nutriComDpa(db, getAuth());
    expect((await todasRedirecionam(ADMIN, n.cookie, '/conta/outro-papel?esperado=admin')).length).toBeGreaterThanOrEqual(5);
  });
```

Atualizar o comentário do topo do arquivo: "… volta ao portal" → "… vai ao aviso de outro papel (`/conta/outro-papel`, P09-03)".

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/lib src/app/conta src/app/painel/acoes-de-paciente.test.ts && pnpm typecheck`
Expected: PASS. Se outro teste unitário esperar a home calada (`/p/inicio`, `/painel`, `/admin`) para papel errado, trocar pela rota do aviso — nunca reverter a regra.

- [ ] **Step 7: E2E**

Em `e2e/portal.spec.ts`, importar `AxeBuilder from '@axe-core/playwright'` e trocar o teste `'nutricionista em /p/inicio volta ao painel'` por:

```ts
test('aparelho com outro papel: a tela diz qual conta está conectada e oferece "Sair" — portal, admin e painel (P09-03)', async ({ browser }) => {
  const aviso = (page: Page) => page.getByRole('status').filter({ hasText: 'Este aparelho está conectado como' });
  await nutri.goto('/p/inicio');
  await expect(nutri).toHaveURL(/\/conta\/outro-papel\?esperado=paciente$/);
  await expect(aviso(nutri)).toHaveText('Este aparelho está conectado como nutricionista. Saia e entre com a conta de paciente.');
  await expect(nutri.getByRole('button', { name: 'Sair' })).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Ir para o painel' })).toHaveAttribute('href', '/painel');
  expect((await new AxeBuilder({ page: nutri }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => v.id)).toEqual([]);
  await nutri.goto('/admin');
  await expect(aviso(nutri)).toHaveText('Este aparelho está conectado como nutricionista. Saia e entre com a conta de administrador.');
  // IP 10.9.17.1 (bloco do Plano 09)
  const p = await pacienteNoPortal(browser, nutri, '10.9.17.1');
  await p.page.goto('/painel/pacientes');
  await expect(p.page).toHaveURL(/\/conta\/outro-papel\?esperado=nutri$/);
  await expect(aviso(p.page)).toHaveText('Este aparelho está conectado como paciente. Saia e entre com a conta de nutricionista.');
  await expect(p.page.getByText(p.email)).toHaveCount(0); // Review Focus 4: nada da conta na tela
  await expect(p.page.getByText(p.nome)).toHaveCount(0);
  await p.page.context().close();
});
```

(A nutricionista **não** clica em "Sair": a página dela é usada pelos testes seguintes do arquivo.)

Run: `pnpm build && pnpm e2e:seed && pnpm test:e2e e2e/portal.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/session-rules.ts src/lib/session-rules.test.ts src/lib/session.ts src/lib/session.test.ts src/app/conta/outro-papel src/app/painel/acoes-de-paciente.test.ts e2e/portal.spec.ts
git commit -m "feat(sessao): aviso claro quando o aparelho está conectado com outro papel (P09-03)"
```

---

### Task 4: Estabilizar o E2E — tour do primeiro acesso, diário com sessão vencida e offline do plano (P09-04)

Causas na seção "Causas achadas nos logs do CI". Regra desta tarefa: **cada correção espera o que a tela faz sozinha**; nenhum `retries` aumentado, nenhum `waitForTimeout`. Primeiro a causa é **reproduzida** de forma determinística (Passo 1, `page.route`); depois corrigida. A corrida do tour fica presa de vez por um atraso proposital (sem a espera, o teste falha sempre); a do diário fica com o atraso e a espera explícita da resposta.

**Files:**
- Modify: `e2e/manual.spec.ts:9-29` e `:137-150`
- Modify: `e2e/portal.spec.ts:57-79` e `:171-183`
- Modify: `src/app/p/(portal)/diario/diario-form.tsx:9-15,111`; Create: `src/app/p/(portal)/diario/diario-form.test.ts`
- Modify: `scripts/e2e-seed.ts` (limites de login dos IPs do E2E)

**Interfaces:**
- Consumes: `marcarGuiaAction(id, versao, estado)` (Server Action do painel; corpo do POST = JSON dos argumentos, ex.: `["boas-vindas",1,"dispensado"]`); `POST /api/p/acesso` (`RegistrarAcesso`).
- Produces: nada para outras tarefas.

- [ ] **Step 1: Reproduzir antes de corrigir (prova da causa)**

Em `e2e/manual.spec.ts`, no teste da linha 21, **antes** do `page.keyboard.press('Escape')`, acrescentar só o atraso:

```ts
  // P09-04: rede lenta de propósito na gravação do progresso (sem a espera abaixo, o reload cortava o POST: CI 05/10)
  await page.route('**/painel', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => undefined); // o reload pode ter cancelado o pedido
  });
```

Em `e2e/portal.spec.ts`, no teste da linha 171 (reprodução **temporária**: força a ordem ruim do CI — a resposta do `POST /api/p/acesso`, com o `Set-Cookie` da sessão renovada, chega depois do `clearCookies()` e antes do clique):

```ts
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  await p.page.route('**/api/p/acesso', async (route) => {
    await solto;
    await route.continue().catch(() => undefined);
  });
  await p.page.goto('/p/diario');
  await p.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await p.page.getByLabel('O que você comeu?').fill('iogurte com granola');
  await p.page.context().clearCookies();
  const respondeu = p.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/p/acesso');
  soltar();
  await respondeu; // o cookie de sessão voltou
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  // … (o resto do teste igual: o alerta não aparece — o registro foi salvo com a sessão "ressuscitada")
```

Run: `pnpm build && pnpm e2e:seed && pnpm test:e2e e2e/manual.spec.ts e2e/portal.spec.ts --retries=0`
Expected: FAIL nos dois testes, com as mesmas mensagens do CI (manual: `toBeHidden` depois do reload; portal: o alerta "Sessão expirada. Entre de novo." não aparece). Se algum **passar**, a causa não é a da tabela: parar, abrir o trace (`pnpm exec playwright show-trace test-results/…/trace.zip`) e registrar a causa real no relatório antes de seguir.

- [ ] **Step 2: Corrigir o tour (manual.spec)**

Em `e2e/manual.spec.ts`:

```ts
// P09-04: o estado do primeiro acesso é gasto na 1ª tentativa (o progresso fica gravado): uma nova tentativa no mesmo
// banco sempre falharia com outro erro (run 37325291299). Falha de verdade aparece uma vez, com a causa certa.
test.describe.configure({ mode: 'serial', retries: 0 });
```

e, junto de `tour`/`semViolacoes`:

```ts
/** A gravação do progresso terminou: marcarGuiaAction é chamada sem await no cliente (otimista, guia-do-painel.tsx). */
const gravou = (estado: 'dispensado' | 'concluido' | 'visto') =>
  page.waitForResponse((r) => r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined && (r.request().postData() ?? '').includes(`"${estado}"`));
```

No teste da linha 21, depois do `page.route(…)` do Passo 1:

```ts
  const salvo = gravou('dispensado');
  await page.keyboard.press('Escape');
  await expect(tour()).toBeHidden();
  expect((await salvo).ok()).toBe(true); // só recarrega depois de o servidor gravar
  await page.unroute('**/painel');
  await page.reload();
```

No teste "Primeira vez aqui?" (linha 137), registrar a espera **antes** do `goto` e esperar antes do `reload` final:

```ts
  const vistoDiarios = gravou('visto');
  await page.goto('/painel/diarios');
  // … (igual)
  await expect(dica).toBeHidden(); // sem recarregar: o "visto" já está no progresso local
  expect((await vistoDiarios).ok()).toBe(true);
  await page.reload();
```

- [ ] **Step 3: Corrigir o diário com sessão vencida (portal.spec e o formulário)**

Teste primeiro: criar `src/app/p/(portal)/diario/diario-form.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// P09-04: antes da hidratação, "Registrar" faria um envio nativo do formulário — um GET com o texto do diário (dado de
// saúde) na URL, que vai para o log de acesso e o Referer. No HTML do servidor o botão nasce desabilitado.
// (Os testes do projeto são `.ts`, sem JSX: createElement.)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { DiarioForm } = await import('./diario-form');

describe('DiarioForm antes da hidratação (P09-04)', () => {
  it('"Registrar" desabilitado no HTML do servidor', () => {
    const html = renderToStaticMarkup(createElement(DiarioForm));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Registrar<\/button>/);
  });
});
```

Run: `pnpm vitest run 'src/app/p/(portal)/diario/diario-form.test.ts'`
Expected: FAIL (o botão nasce habilitado).

Em `diario-form.tsx`: importar `useSyncExternalStore` de `react` e, no componente:

```tsx
/** true só no cliente depois da hidratação (no servidor e na hidratação, false) — sem setState em efeito. */
const semInscricao = () => () => {};
// …
  const hidratado = useSyncExternalStore(semInscricao, () => true, () => false);
// …
      <button disabled={enviando || !hidratado} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">Registrar</button>
```

(`semInscricao` fica fora do componente, no topo do arquivo.)

Em `e2e/portal.spec.ts`, no teste da linha 171: **tirar** a reprodução temporária do Passo 1 e deixar o começo assim (o atraso de 1,5 s fica: rede lenta não pode mudar o resultado):

```ts
  // P09-04: o POST /api/p/acesso da abertura devolve Set-Cookie com a sessão renovada (P06-11). Se a resposta chegasse
  // depois do clearCookies, a sessão "voltava" e o registro era salvo (run 37304638500): esperar por ela antes.
  await p.page.route('**/api/p/acesso', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => undefined);
  });
  const acesso = p.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/p/acesso');
  await p.page.goto('/p/diario');
  await acesso;
  await p.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await p.page.getByLabel('O que você comeu?').fill('iogurte com granola');
  await p.page.context().clearCookies(); // a sessão "vence" com a página aberta
  await p.page.getByRole('button', { name: 'Registrar' }).click(); // o clique espera o botão habilitar (hidratação)
  // … (o resto igual)
```

- [ ] **Step 4: Corrigir o offline do plano (portal.spec:57)**

No teste da linha 57, trocar as linhas 73–74 (`setOffline(false)` + `goto('/p/inicio')`) por:

```ts
  // P09-04: a cópia de "Meu plano" servida offline em /p/inicio navega sozinha para /p/plano quando a rede volta e
  // atropelava o goto (run 37304638500). Sair dela antes de religar a rede.
  await p.page.goto('about:blank');
  await p.page.context().setOffline(false);
  await p.page.goto('/p/inicio');
```

- [ ] **Step 5: Limites de login para rodar várias vezes seguidas**

O login tem 5 tentativas por 15 min por IP (`src/lib/auth.ts:128`) e o `e2e:seed` não zera a tabela `rate_limit`: a 6ª execução seguida esbarraria nele. Em `scripts/e2e-seed.ts` (importar `like` de `drizzle-orm` e `rateLimit` de `@/db/schema`), junto das outras limpezas de limite:

```ts
// P09-04: o seed zera os limites de login do Better Auth dos IPs do E2E (chave "<ip>|<caminho>", só a faixa 10.9.x.x):
// rodar o E2E várias vezes seguidas não esbarra nas 5 tentativas por 15 min
await db.delete(rateLimit).where(like(rateLimit.key, '10.9.%'));
```

- [ ] **Step 6: Rodar cada spec 5 vezes seguidas**

Run:

```bash
pnpm build
for i in 1 2 3 4 5; do pnpm e2e:seed && pnpm test:e2e e2e/manual.spec.ts --retries=0 || { echo "falhou na rodada $i"; break; }; done 2>&1 | tee /tmp/claude-e2e-manual.log
for i in 1 2 3 4 5; do pnpm e2e:seed && pnpm test:e2e e2e/portal.spec.ts --retries=0 || { echo "falhou na rodada $i"; break; }; done 2>&1 | tee /tmp/claude-e2e-portal.log
grep -c "destination stream closed early" /tmp/claude-e2e-manual.log /tmp/claude-e2e-portal.log
```

(Use o diretório de rascunho da sessão no lugar de `/tmp` quando houver um.)
Expected: 5 de 5 sem falha em cada spec. Para cada "The destination stream closed early" que sobrar, achar no trace o teste que fecha a página ou recarrega com resposta em andamento e registrar no relatório; não esconder a mensagem (ela é do Next quando o navegador corta uma resposta).

- [ ] **Step 7: Unitários e commit**

Run: `pnpm vitest run 'src/app/p/(portal)/diario' && pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add e2e/manual.spec.ts e2e/portal.spec.ts 'src/app/p/(portal)/diario/diario-form.tsx' 'src/app/p/(portal)/diario/diario-form.test.ts' scripts/e2e-seed.ts
git commit -m "test(e2e): corridas do tour, do diário com sessão vencida e do offline do plano (P09-04)"
```

---

### Task 5: Painel da nutricionista instalável (PWA) sem cópia offline de dado de saúde (P09-05)

Antes de escrever: ler `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` (campo `manifest`) e `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`. O `src/app/manifest.ts` (portal) põe o `<link rel="manifest">` em todas as páginas; o `metadata.manifest` de um layout filho o substitui (`resolve-metadata.js`: a chave `manifest` do filho vence).

**Files:**
- Create: `src/app/manifesto-painel.ts`, `src/app/manifesto-painel.test.ts`
- Create: `src/app/painel.webmanifest/route.ts`
- Modify: `src/app/painel/layout.tsx` (só o `metadata`)
- Create: `public/icones/painel.svg`, `public/icones/painel-192.png`, `public/icones/painel-512.png`, `public/icones/painel-maskable-512.png`, `public/icones/painel-apple-touch-icon.png`; Modify: `scripts/gerar-icones.ts`
- Create: `src/app/sw-escopo.test.ts`; Modify: `src/app/sw-regras.test.ts`
- Create: `e2e/painel-pwa.spec.ts`

**Interfaces:**
- Consumes: `manifest()` do portal (`src/app/manifest.ts`) só nos testes (ids diferentes).
- Produces: `MANIFESTO_DO_PAINEL_URL = '/painel.webmanifest'`; `manifestoDoPainel(): MetadataRoute.Manifest`; `METADADOS_DO_PAINEL: Metadata`.

- [ ] **Step 1: Escrever os testes que falham (manifest)**

Criar `src/app/manifesto-painel.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestDoPortal from './manifest';
import { MANIFESTO_DO_PAINEL_URL, manifestoDoPainel, METADADOS_DO_PAINEL } from './manifesto-painel';
import { GET } from './painel.webmanifest/route';

const dentro = (url: string, escopo: string) => new URL(url, 'https://x.dev').pathname.startsWith(escopo);

describe('manifest do painel da nutricionista (P09-05)', () => {
  it('app próprio: id e ícones diferentes dos do portal; abre no Início do painel numa janela sem barra de endereço', () => {
    const m = manifestoDoPainel();
    expect(m).toMatchObject({ id: '/painel', start_url: '/painel', display: 'standalone', lang: 'pt-BR', name: 'NutriDebby — Painel', short_name: 'Painel ND' });
    expect(m.id).not.toBe(manifestDoPortal().id);
    expect(m.icons!.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const i of m.icons!) {
      expect(existsSync(path.join('public', i.src)), i.src).toBe(true);
      expect(manifestDoPortal().icons!.map((p) => p.src)).not.toContain(i.src);
    }
    expect(m.orientation).toBeUndefined(); // WCAG 1.3.4
  });

  it('Review Focus 5 (D7): o escopo cobre o painel, o login e a Segurança — o login a cada 12 h ociosas fica na janela do app', () => {
    const { scope, start_url } = manifestoDoPainel();
    for (const url of [start_url!, '/painel/pacientes', '/entrar', '/entrar/2fa', '/conta/seguranca', '/conta/outro-papel']) expect(dentro(url, scope!), url).toBe(true);
  });

  it('D8: o manifest não declara service worker', () => {
    expect(manifestoDoPainel()).not.toHaveProperty('serviceworker');
  });

  it('a rota serve o mesmo manifest com o tipo certo; o layout do painel aponta para ela', async () => {
    const r = await GET();
    expect(r.headers.get('content-type')).toBe('application/manifest+json');
    expect(await r.json()).toEqual(JSON.parse(JSON.stringify(manifestoDoPainel())));
    expect(METADADOS_DO_PAINEL.manifest).toBe(MANIFESTO_DO_PAINEL_URL);
    expect(readFileSync('src/app/painel/layout.tsx', 'utf8')).toContain('export const metadata: Metadata = METADADOS_DO_PAINEL;');
  });
});
```

Run: `pnpm vitest run src/app/manifesto-painel.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 2: Implementar manifest, rota, metadados e ícones**

Criar `src/app/manifesto-painel.ts` (fora de `src/app/painel`: a guarda de cores proíbe cor fixa lá):

```ts
import type { Metadata, MetadataRoute } from 'next';

/** P09-05: o painel da nutricionista instalável numa janela própria. Separado do app do portal pelo `id`. */
export const MANIFESTO_DO_PAINEL_URL = '/painel.webmanifest';

export function manifestoDoPainel(): MetadataRoute.Manifest {
  return {
    id: '/painel',
    name: 'NutriDebby — Painel',
    short_name: 'Painel ND',
    description: 'Painel da nutricionista',
    lang: 'pt-BR',
    start_url: '/painel',
    // D7: '/' e não '/painel' — o login (/entrar) e a Segurança (/conta) ficam dentro da janela do app; no iPhone, sair do
    // escopo abre o Safari, com outros cookies, e o login não voltaria para o app
    scope: '/',
    display: 'standalone',
    // sem `orientation` (WCAG 2.1 AA 1.3.4) e sem service worker (D8: nada do painel guardado no aparelho)
    background_color: '#ffffff',
    theme_color: '#1d6b5a',
    // arte provisória (o dono define o layout depois): `pnpm icones` gera os PNG a partir de public/icones/painel.svg
    icons: [
      { src: '/icones/painel-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/painel-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icones/painel-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** `metadata` do layout do painel: o manifest dele (substitui o do portal, que o app/manifest.ts põe em toda página) e o iPhone. */
export const METADADOS_DO_PAINEL: Metadata = {
  manifest: MANIFESTO_DO_PAINEL_URL,
  // o iPhone usa o apple-touch-icon e o título daqui, não os do manifest
  appleWebApp: { capable: true, title: 'Painel ND', statusBarStyle: 'default' },
  icons: { apple: '/icones/painel-apple-touch-icon.png' },
};
```

Criar `src/app/painel.webmanifest/route.ts`:

```ts
import { manifestoDoPainel } from '../manifesto-painel';

/**
 * P09-05: fora de /painel de propósito — o navegador busca o manifest sem cookie, e /painel é protegido no proxy
 * (sem cookie, redirect para /entrar). Conteúdo fixo, sem dado de ninguém.
 */
export function GET(): Response {
  return new Response(JSON.stringify(manifestoDoPainel()), {
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' },
  });
}
```

Em `src/app/painel/layout.tsx`:

```ts
import type { Metadata } from 'next';
import { METADADOS_DO_PAINEL } from '@/app/manifesto-painel';
// …
export const metadata: Metadata = METADADOS_DO_PAINEL;
```

Criar `public/icones/painel.svg` (arte provisória: a folha do portal invertida, numa placa verde dentro da zona segura do maskable):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f4faf8"/>
  <rect x="72" y="72" width="368" height="368" rx="72" fill="#1d6b5a"/>
  <path fill="#ffffff" d="M256 132c-74 42-114 104-114 166 0 54 40 90 96 96v-88c-26-14-42-40-46-70 32 8 54 28 64 54 10-26 32-46 64-54-4 30-20 56-46 70v88c56-6 96-42 96-96 0-62-40-124-114-166z"/>
</svg>
```

Em `scripts/gerar-icones.ts`, gerar também os do painel:

```ts
// D21 / P09-05: ícones do PWA a partir dos SVG (rodar com `pnpm icones` quando a arte mudar; os PNG ficam no repositório).
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const conjuntos: [string, [string, number][]][] = [
  ['public/icones/icone.svg', [
    ['public/icones/icone-192.png', 192],
    ['public/icones/icone-512.png', 512],
    ['public/icones/icone-maskable-512.png', 512],
    ['public/icones/apple-touch-icon.png', 180],
  ]],
  ['public/icones/painel.svg', [
    ['public/icones/painel-192.png', 192],
    ['public/icones/painel-512.png', 512],
    ['public/icones/painel-maskable-512.png', 512],
    ['public/icones/painel-apple-touch-icon.png', 180],
  ]],
];
let n = 0;
for (const [origem, saidas] of conjuntos) {
  const svg = await readFile(origem);
  for (const [arquivo, lado] of saidas) {
    await sharp(svg, { density: 384 }).resize(lado, lado).png({ compressionLevel: 9 }).toFile(arquivo);
    n++;
  }
}
console.log(`ícones gerados: ${n}`);
```

Run: `pnpm icones && git status --short public/icones`
Expected: os 4 PNG do painel novos. Se os PNG do portal aparecerem alterados, conferir que a imagem é a mesma (`git diff --stat`) e **não** os incluir no commit (`git checkout -- public/icones/icone-*.png public/icones/apple-touch-icon.png`).

Run: `pnpm vitest run src/app/manifesto-painel.test.ts src/app/manifest.test.ts`
Expected: PASS.

- [ ] **Step 3: Guardas — nenhum service worker cobre o painel (D8)**

Criar `src/app/sw-escopo.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// P09-05 (D8): o service worker do Serwist guarda o plano do paciente (US-040) e só pode existir para o portal. A rota
// /serwist/sw.js manda `Service-Worker-Allowed: /` (@serwist/turbopack): o que limita o escopo é o registro, aqui.
const FONTES = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => path.join('src', f));
const comTexto = (re: RegExp) => FONTES.filter((f) => re.test(readFileSync(f, 'utf8')));

describe('nenhum service worker cobre o painel (P09-05, D8)', () => {
  it('o SerwistProvider só existe no portal, com scope /p/', () => {
    expect(comTexto(/SerwistProvider/)).toEqual([path.join('src', 'app', 'p', 'sw-provider.tsx')]);
    expect(readFileSync('src/app/p/sw-provider.tsx', 'utf8')).toMatch(/options=\{\{\s*scope:\s*'\/p\/'\s*\}\}/);
  });
  it('ninguém registra service worker à mão', () => {
    expect(comTexto(/serviceWorker\s*\.\s*register\s*\(/)).toEqual([]);
  });
  it('nada do painel importa o provider do portal', () => {
    expect(comTexto(/sw-provider/).filter((f) => !f.startsWith(path.join('src', 'app', 'p') + path.sep))).toEqual([]);
  });
});
```

Em `src/app/sw-regras.test.ts`, acrescentar:

```ts
describe('P09-05 (D8): as regras do service worker nunca tratam o painel', () => {
  it('navegação e "Meu plano" só em /p/: /painel, /painel/pacientes/… e /conta ficam de fora', () => {
    for (const p of ['/painel', '/painel/', '/painel/pacientes/123', '/painel.webmanifest', '/conta/seguranca', '/p']) {
      expect(ehNavegacaoDoPortal(new URL(`${O}${p}`), 'navigate', O), p).toBe(false);
      expect(ehPaginaDoPlano(new URL(`${O}${p}`), 'navigate', O), p).toBe(false);
    }
  });
});
```

Run: `pnpm vitest run src/app/sw-escopo.test.ts src/app/sw-regras.test.ts`
Expected: PASS (as guardas descrevem o estado atual e quebram se alguém registrar um SW para o painel).

- [ ] **Step 4: E2E no navegador**

Criar `e2e/painel-pwa.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

// P09-05. IP 10.9.17.10 (bloco do Plano 09).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('painel instalável: manifest próprio no <head>, nenhum service worker e HTML sem cache (P09-05)', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.17.10');
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/painel.webmanifest');
  const m = await (await page.request.get('/painel.webmanifest')).json();
  expect(m).toMatchObject({ id: '/painel', start_url: '/painel', scope: '/', display: 'standalone' });
  expect((await page.request.get('/painel')).headers()['cache-control']).toContain('no-store');
  await page.goto('/painel/pacientes');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  // o login continua com o manifest do portal (o do painel só vale nas telas do painel)
  await page.goto('/entrar');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await page.context().close();
});
```

Run: `pnpm build && pnpm e2e:seed && pnpm test:e2e e2e/painel-pwa.spec.ts`
Expected: PASS. Se o `<head>` do painel trouxer **dois** `link[rel="manifest"]`, o `toHaveAttribute` falha por ambiguidade: parar e reler o guia de metadata (a substituição pelo layout filho é o que a D8 pressupõe).

Conferência manual (registrar no relatório, não automatizada): Chrome desktop em `http://localhost:3100/painel` mostra "Instalar NutriDebby — Painel" na barra de endereço; instalado, abre em `/painel` numa janela sem barra de endereço.

- [ ] **Step 5: Rodar tudo e commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/app/manifesto-painel.ts src/app/manifesto-painel.test.ts src/app/painel.webmanifest/route.ts src/app/painel/layout.tsx public/icones/painel.svg public/icones/painel-192.png public/icones/painel-512.png public/icones/painel-maskable-512.png public/icones/painel-apple-touch-icon.png scripts/gerar-icones.ts src/app/sw-escopo.test.ts src/app/sw-regras.test.ts e2e/painel-pwa.spec.ts
git commit -m "feat(painel): painel instalável (PWA) com manifest próprio e sem service worker (P09-05)"
```

---

## Fechamento do plano (após a Tarefa 5)

1. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` e o E2E inteiro (`pnpm e2e:seed && pnpm test:e2e`) verdes no branch `plano-09-fechamento-mvp`.
2. Revisão final do branch (workflow) → PR → `/code-review high` uma vez → correções Critical/Important → re-revisão só do diff → `/security-review` (foco: rotas de escrita e origem, função SECURITY DEFINER da 0094, reinício do 2FA e o comando no container, tela de outro papel sem vazamento, manifest/SW).
3. Depois do merge (OK do dono, snapshot no hPanel): conferir no log do `nutri_worker` a linha "esperando o app aplicar as migrations" seguida de "schema do banco em dia" (ou nenhuma, se o app terminou antes) e o `/api/health` 200. Conferências em produção só pelo controlador, com OK do dono.
4. Atualizar o índice dos planos e o backlog (P09-01 a P09-05 ✅; P09-00 e P09-06 seguem abertos) — não antes do fechamento.

## Autorrevisão do plano (writing-plans)

- **Cobertura:** P09-01 → T1 (rota + guarda + E2E do editor). P09-02 (a) → T2 A1–A9 (espera limitada, sem rodar migration, antes dos consumidores); (b) → T2 B1–B8 (ação com confirmação, registro, apaga `two_factor`, `two_factor_enabled=false`, revoga sessões, regra 1 do CLAUDE.md). P09-03 → T3 (texto pedido, "Sair", portal/painel/admin, pt-BR, sem dado). P09-04 → T4 (causas dos logs, sem retries, 5× cada spec). P09-05 → T5 (manifest/escopo próprio, ícone e nome, nenhum SW no painel, testes do manifest e das regras do SW).
- **Placeholders:** nenhum "TBD"; o único passo condicional é o "se passar, a causa é outra" da T4, que manda parar e registrar.
- **Nomes:** `esperarVersaoDoSchema`/`versaoEsperada`/`versaoAplicada` (T2a); `reiniciarDoisFatores`/`Reiniciar2faError`/`MSG_2FA`/`reiniciar2faAction` (T2b); `OUTRO_PAPEL_PATH`/`caminhoOutroPapel`/`textoOutroPapel` (T3); `MANIFESTO_DO_PAINEL_URL`/`manifestoDoPainel`/`METADADOS_DO_PAINEL` (T5) — iguais em todos os passos.
- **Review Focus:** cada linha tem teste na tarefa dona (T1 P1/P6, T2 A1, T2 B1, T3 P1/P7, T5 P1/P3).

## Execução

Modo **misto**, aprovado pelo dono em 06/10/2026: o workflow `.superpowers/sdd/2026-10-06-plano09/workflow.js` executa tarefa a tarefa (implementador + revisores por tarefa, briefs em `.superpowers/sdd/2026-10-06-plano09/task-N-brief.md`), na ordem T1 → T2 → T3 → T4 → T5, no worktree `nutridebby-plano09` (branch `plano-09-fechamento-mvp`). Nada de merge sem o OK do dono.
