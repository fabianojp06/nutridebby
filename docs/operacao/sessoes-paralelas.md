# Sessões paralelas do Claude Code (PD-01)

Como rodar até **3 sessões** do Claude Code ao mesmo tempo no NutriDebby sem que uma pise na outra. Vale para o backlog
"Paridade Dietbox" e para qualquer onda com mais de um plano em andamento. Script de preparo:
`scripts/sessao-paralela.sh`. Painel das sessões: backlog Paridade Dietbox
(<https://claude.ai/artifact/H7ps2fUZGKUXrB76Gte4me>). Horários em BRT (a VPS está em UTC).

## 1. Regra de ouro: uma sessão = um worktree + um branch + um plano

- Cada sessão trabalha num **worktree próprio** ao lado do principal: `../nutridebby-a`, `../nutridebby-b`,
  `../nutridebby-c` (o principal, `nutridebby/`, fica na `main` e é da orquestradora).
- Cada worktree tem **um branch** e implementa **um plano** (ou um item do backlog). Plano novo = sessão nova ou a
  mesma sessão depois do merge do anterior.
- **Nunca dois implementadores na mesma árvore.** Dois agentes editando o mesmo worktree se atropelam no `git add`,
  no `.next/`, no `node_modules` e no banco. Subagentes de revisão podem ler o worktree de outra sessão; escrever, não.
- A `main` nunca é branch de sessão (o script recusa).

## 2. Por que no máximo 3 sessões de código

A VPS tem **8 vCPU e 31 GiB** e divide tudo com:

- a **produção** (`nutri_app`, `nutri_worker`, `nutri_db` e o Awave Agents);
- o **único runner self-hosted do CI** (`[self-hosted, nutri-ci]` em `.github/workflows/ci.yml`; desenho em
  `docs/operacao/runner-proprio.md`), limitado a 4 vCPU pela `user-1500.slice` e rodando **um job por vez**. Os tempos
  medidos lá: `quality` 2 min, `test` 6 min, `e2e` 18 min, `image` 4 min — cerca de 30 min por rodada. Com três
  sessões abrindo PR, o CI **entra em fila**, e o custo é maior que "o terceiro espera os outros dois": cada merge
  obriga os PRs seguintes a fazer rebase e rodar o CI de novo. Três PRs na fila dão cerca de 3 + 2 + 1 = 6 rodadas,
  perto de 3 h.
- O deploy só pula o CI no push da `main` quando `.github/scripts/ci-ja-passou.sh` confirma que a árvore do merge é
  idêntica à do head do PR e que o PR já continha a `main` anterior. Por isso o **rebase antes do merge** é o que evita
  uma rodada a mais no deploy: PR desatualizado roda os ~30 min de novo antes do publish.

Cada sessão também roda `pnpm test` (sobe um Postgres pelo Testcontainers), `next dev`/`next build` e, às vezes, o
Playwright. Mais de 3 sessões de código disputam CPU com a produção. Sessões só de leitura (spec, revisão) não contam
no limite, mas também não rodam suíte pesada ao mesmo tempo que as outras.

## 3. Porta e banco próprios

| Sessão | Worktree | Branch | Porta (`APP_URL`) | Banco (Postgres de dev) |
| --- | --- | --- | --- | --- |
| principal | `nutridebby/` | `main` | 3100 (`pnpm dev`) | `nutri` |
| A | `../nutridebby-a` | o do plano | 3101 | `nutri_dev_a` |
| B | `../nutridebby-b` | o do plano | 3102 | `nutri_dev_b` |
| C | `../nutridebby-c` | o do plano | 3103 | `nutri_dev_c` |

- Os bancos ficam todos no **mesmo** Postgres do `docker-compose.dev.yml` (serviço `db`, `postgres:16-alpine`,
  `127.0.0.1:54329`, dono `nutri_owner`, `mem_limit: 512m`). Suba-o uma vez, no worktree principal:
  `docker compose -f docker-compose.dev.yml up -d`.
- O `.env.local` de cada worktree é cópia do principal com três trocas: `APP_URL=http://localhost:310x` e o nome do
  banco em `DATABASE_URL` e `DATABASE_URL_MIGRATOR` (`nutri_dev_x`). O `pnpm db:migrate`, o `pnpm worker` e o
  `pnpm e2e:seed` leem o `.env.local` do worktree (`tsx --env-file-if-exists=.env.local`, `package.json`).
- Os roles (`nutri_app_role`, `nutri_app`) são do cluster e servem aos quatro bancos: a migration
  `0000_base_roles_e_rls.sql` só cria o role se ele faltar, e o `db:migrate` (`src/db/migrate.ts`) concede `CONNECT` no
  banco da vez. O script cria o banco com dono `nutri_owner`, o role do `DATABASE_URL_MIGRATOR` (regra 7), como em
  produção. Em dev o `nutri_owner` também é o superusuário do cluster (`POSTGRES_USER` do compose), então o
  `REVOKE TEMPORARY` do `db:migrate` funcionaria mesmo com outro dono; o dono certo é para espelhar a produção.
- **Variável exportada no shell vence o `.env.local`.** O `tsx --env-file-if-exists` (`db:migrate`, `worker`,
  `e2e:seed`) e o `next dev` não sobrescrevem o que já está no ambiente. Uma `DATABASE_URL`, `DATABASE_URL_MIGRATOR`,
  `APP_URL` ou `DATA_DIR` exportada (de uma conferência de deploy, de um `source`, do ambiente da orquestradora) leva a
  sessão para outro banco ou outra porta sem aviso. Nas sessões, nenhuma delas fica exportada; o script recusa se
  achar alguma. Confira com `env | cut -d= -f1 | grep -E '^(DATABASE_URL|APP_URL|DATA_DIR)'` (só os nomes).
- **Dev:** o `pnpm dev` fixa a 3100 (`next dev -p 3100`). Nas sessões, suba com `pnpm exec next dev -p 310x`. O
  worker de cada sessão (`pnpm worker`) usa a fila do pg-boss do banco da sessão, isolada das outras.
- **Arquivos:** `DATA_DIR=./data` é relativo, então cada worktree tem a própria pasta. Se o `.env.local` principal
  tiver caminho absoluto, as sessões dividem a pasta (o script avisa).
- **Vitest** já isola: cada `pnpm test` sobe o próprio Postgres pelo Testcontainers (`test/postgres-teste.ts`) e não
  usa o banco da sessão. Três suítes ao mesmo tempo pesam na CPU; escalone.
- **E2E:** fora do CI, o `playwright.config.ts` carrega o `.env.local` do worktree (`process.loadEnvFile`, SUS-101):
  a `APP_URL` dá a porta do `next start` e o `baseURL`, e a `DATABASE_URL` vale para os workers do Playwright e para os
  helpers que abrem o banco (`e2e/whatsapp.ts`), como no `pnpm worker` e no `pnpm e2e:seed`. Variável exportada no
  shell continua vencendo (o `loadEnvFile` não sobrescreve). Antes do SUS-101 o `pnpm test:e2e` não lia o `.env.local`:
  sem `APP_URL` caía na 3100 e o `e2e/whatsapp.ts` caía no banco `nutri` do principal. No CI, só as variáveis do job.
  Ordem na sessão: `pnpm e2e:seed`, `pnpm build`, `pnpm test:e2e`. Cuidados:
  - o Playwright sempre sobe o próprio worker (`reuseExistingServer: false`): pare o `pnpm worker` da sessão antes,
    para não haver dois workers na mesma fila;
  - fora do CI ele **reaproveita** um servidor que já esteja na porta (`reuseExistingServer: !process.env.CI`): com o
    `next dev` da sessão no ar, o E2E roda contra o dev, não contra o build;
  - o **Mailpit é um só** (`127.0.0.1:8025`) e o `e2e/mailpit.ts` procura o e-mail pelo destinatário; as sementes dos
    worktrees usam os mesmos e-mails. **Um E2E de cada vez entre as sessões.**
- **MCP `postgres-dev`** (`.mcp.json`) aponta para `NUTRI_DEV_DATABASE_URL`, isto é, para o banco que o dono
  configurou (normalmente o `nutri` do principal), não para o banco da sessão. Para olhar o banco da sessão, use
  `docker compose -f docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_x`. Nunca em produção (regra 5).

## 4. Preparar uma sessão: `scripts/sessao-paralela.sh`

```bash
# do worktree principal (ou de qualquer worktree do repositório)
scripts/sessao-paralela.sh a plano-18-exemplo --novo   # cria o branch a partir de origin/main
scripts/sessao-paralela.sh b plano-19-exemplo          # usa um branch que já existe (local ou em origin)
```

O script:

1. recusa sessão fora de `a|b|c`, branch inválido, `main` ou nome com `refs/`, `heads/`, `remotes/` ou `origin/`;
2. recusa se `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `APP_URL` ou `DATA_DIR` estiverem exportadas no shell (venceriam
   o `.env.local`; rode com `env -u <variável>`);
3. recusa se `DATABASE_URL` ou `DATABASE_URL_MIGRATOR` saírem do Postgres de dev: host que não seja
   `localhost`/`127.0.0.1`, porta que não seja a `54329` do compose, qualquer parâmetro na query além de `sslmode` (o
   `pg` deixa `?host=`, `?port=` e `?user=` sobrescreverem a URL) ou `DATABASE_URL_MIGRATOR` com role que não seja
   `nutri_owner`. Confere antes de criar qualquer coisa e de novo no `.env.local` gerado; o erro diz só o nome da
   variável;
4. cria o worktree `../nutridebby-<x>` (recusa se ele já existe com **outro** branch, se a pasta existe e não é
   worktree, ou se o worktree está registrado mas a pasta sumiu: `git worktree prune`); com `--novo`, recusa branch que
   já existe localmente **ou em origin** e cria o branch a partir de `origin/main`, sem upstream (o primeiro push faz
   `git push -u origin <branch>`);
5. copia o `.env.local` do principal com a porta e o banco da sessão (se o worktree já tem `.env.local`, só reaplica
   as trocas e mantém o resto); nunca imprime senha nem o arquivo;
6. cria o banco `nutri_dev_<x>` no serviço `db` do compose de dev, se faltar;
7. roda `pnpm install --frozen-lockfile` e `pnpm db:migrate`;
8. imprime os comandos para subir o dev, o worker e o E2E na porta da sessão.

É idempotente: rodar de novo completa o que faltou (por exemplo, depois de um `pnpm install` que caiu).

**Fechar a sessão** (depois do merge), com OK do dono (é apagar): pare o `next dev` e o `pnpm worker` da sessão (com
conexão aberta o `dropdb` falha com "database is being accessed by other users"), depois
`git worktree remove ../nutridebby-<x>` e
`docker compose -f docker-compose.dev.yml exec db dropdb -U nutri_owner nutri_dev_<x>`.

**Worktrees que já existiam antes do PD-01** (`git worktree list` em 16/11/2026):

- `../nutridebby-a`, branch `plano-17-lembretes-rotina`: já segue a convenção (`APP_URL` na 3101, banco
  `nutri_dev_a`). Vale como **sessão A do Plano 17**, sem fechar nem renomear: `scripts/sessao-paralela.sh a
  plano-17-lembretes-rotina` o reconhece e só reaplica as trocas no `.env.local`. Outro plano na sessão A, só depois
  de fechar esta.
- `../nutridebby-ajuda` (HEAD destacado), `../nutridebby-termos` e `../nutridebby-worker`: são de trabalhos anteriores
  e não são sessões. Não abra sessão neles nem os conte entre A, B e C; se algum estiver com `next dev`, worker ou
  testes no ar, ele pesa na CPU como uma sessão. Removê-los é apagar: só com OK do dono, depois de conferir que o
  branch já entrou na `main` ou foi descartado.

## 5. Migrations em branches paralelos

O Drizzle numera as migrations pela ordem do `drizzle/meta/_journal.json` (`idx`, `tag` como `0117_ia_nutri_funcoes`)
e encadeia os snapshots (`drizzle/meta/NNNN_snapshot.json`: o `prevId` de cada um é o `id` do anterior). Dois branches
que geram migration a partir da mesma `main` criam o **mesmo número**, o mesmo `prevId` e entradas conflitantes no
journal. Pior: o migrador (`drizzle-orm`, `pg-core/dialect.js`) só aplica a migration cujo `when` do journal é **maior**
que o `created_at` da última aplicada no banco. Uma migration gerada antes de outra que já entrou na `main` seria
**pulada em silêncio** num banco que já tem a outra. Por isso a migration do branch é sempre **gerada de novo** em
cima da `main` atual, nunca só renumerada à mão.

Passo a passo, **antes de abrir o PR** (e de novo se outro PR com migration entrar na `main` antes do seu):

1. **Liste e guarde todas as migrations do branch**, geradas e custom (as `rls_*` e qualquer outra criada com
   `--custom`, como a `0117_ia_nutri_funcoes`). As geradas também: muitas recebem edição à mão depois do
   `db:generate` (o `UPDATE "tenants"` de dados da `0067`, o `CREATE OR REPLACE FUNCTION` da `0093`, comentários na
   `0009`, `0062`, `0066`, `0068`, `0071` e `0097`), e o passo 4 joga essa edição fora. Anote também a ordem em que
   elas se intercalam:

   ```bash
   git fetch origin
   git diff --name-only --diff-filter=A origin/main...HEAD -- drizzle/
   mkdir -p ../migrations-<x> && cp drizzle/NNNN_*.sql ../migrations-<x>/   # cada migration do branch
   ```

2. **Rebase em `main`:** `git rebase origin/main`. Conflito em `drizzle/` (journal ou snapshot com o mesmo número):
   fique com a versão da `main` (`git checkout origin/main -- <arquivo>`); arquivo que só existe no branch pode sair
   (`git rm <arquivo>`), porque será gerado de novo no passo 4. Depois `git add` e `git rebase --continue`. Conflito
   no schema (`src/db/schema/`) se resolve juntando as duas mudanças: ele é a fonte da migration nova.
3. **Remova as migrations do branch:** apague os SQL do branch (`drizzle/NNNN_*.sql`), os snapshots dele
   (`drizzle/meta/NNNN_snapshot.json`) e volte o journal ao da `main`
   (`git checkout origin/main -- drizzle/meta/_journal.json`). Depois disso, `drizzle/` deve ser igual ao da `main`
   (`git diff origin/main -- drizzle/` vazio).
   Atalho: antes do rebase, um commit que volte `drizzle/` ao merge-base
   (`git checkout $(git merge-base origin/main HEAD) -- drizzle/` e commit) faz o rebase não conflitar no
   `_journal.json` e nos snapshots a cada commit do branch, e os passos 2 e 3 encurtam.
4. **Gere de novo** a migration do schema: `pnpm db:generate` (sai com o número seguinte ao último da `main`, `when`
   novo e snapshot encadeado no último da `main`). Compare o SQL novo com o das geradas guardadas no passo 1
   (`diff`) e **reaplique as edições à mão** (dados, funções, comentários).
   - **Gerada e custom intercaladas** (como no Plano 14B: `0111` gerada, `0112` custom, `0113` gerada, `0114` custom):
     um `db:generate` só junta as geradas numa migration, e as custom passam a rodar depois de todas. Se uma custom
     precisa rodar **entre** duas geradas (um backfill antes de um `NOT NULL`, por exemplo), regenere por etapas:
     aplique ao schema só a parte da primeira gerada, `pnpm db:generate`, recrie a custom do meio, depois o resto do
     schema e `pnpm db:generate` de novo.
5. **Recrie as custom**, na ordem original: `pnpm drizzle-kit generate --custom --name rls_<tabela>` e cole o SQL
   guardado no passo 1 no arquivo novo. Confira a regra 2 do `CLAUDE.md` (`app_enable_tenant_rls`,
   `app_enable_patient_rls`, `app_enable_staff_only` etc.) e a regra 8 (`app_enable_audit`).
6. **Confira o encadeamento:** índices seguidos no `_journal.json`, `prevId` de cada snapshot novo igual ao `id` do
   anterior, `pnpm drizzle-kit check` sem erro. **Corrija as referências** ao número antigo (como já pede o
   `docs/manual-tecnico/07-testes-qualidade-e-processo.md`, §7.11 item 6): há testes que leem migration pelo nome
   (`src/db/migrate.test.ts`, `src/db/migrate-owner.test.ts`), e planos, `CLAUDE.md` e o manual técnico citam números.
   `grep -rn "<NNNN antigo>" src test docs CLAUDE.md` para cada migration renumerada.
7. **Banco limpo:** com OK do dono (é apagar, mesmo sendo dev), pare o `next dev` e o `pnpm worker` da sessão (com
   conexão aberta o `dropdb` falha), recrie o banco da sessão (dev, nunca produção) e migre do zero:

   ```bash
   docker compose -f ../nutridebby/docker-compose.dev.yml exec db dropdb -U nutri_owner --if-exists nutri_dev_<x>
   ../nutridebby/scripts/sessao-paralela.sh <x> <branch>   # recria o banco e roda o pnpm db:migrate
   ```

8. **Testes de RLS e auditoria:**
   `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts` (mais os testes de schema
   do plano, em `src/db/*.test.ts`), e a suíte toda antes do push.

**Só um PR com migration na fila de merge por vez.** O segundo espera o primeiro entrar na `main` e refaz os passos 1
a 8. Mesmo assim, migrations sempre com `DATABASE_URL_MIGRATOR` (regra 7).

## 6. Arquivos disputados

Estes arquivos recebem acréscimos de quase todo plano. Nas sessões paralelas: **só acrescentar** (nada de reordenar,
reformatar ou reescrever o que já existe), e **quem entra depois resolve o conflito no rebase**, mantendo as duas
contribuições.

| Arquivo | O que costuma entrar |
| --- | --- |
| `src/db/rls-guard.ts` | `RLS_EXCEPTIONS`, `STAFF_ONLY`, `PUBLICO_LIBERADO`, `PACIENTE_ESCREVE`, `CONTEUDO_POR_AUDIENCIA` |
| `src/db/audit-guard.ts` | `AUDIT_EXCEPTIONS` |
| `test/isolamento.test.ts` | `FABRICAS`, `COM_MAE`, `ULTIMAS`, `SEM_DELETE`, `IMUTAVEIS`, `SO_INSERE`, `SO_APAGA` |
| `CLAUDE.md` | regras 1, 2 e 8 (exceções de RLS, tabelas novas, auditoria) |
| `src/app/painel/navegacao.ts` | itens do menu do painel |
| `src/app/painel/pacientes/[id]/abas.tsx` | abas da ficha do paciente |
| `docs/manual-tecnico/` | capítulos e o índice/glossário do `README.md` |
| `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md` | itens do backlog (o arquivo mais alterado do repositório) |
| `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md` | linha de cada plano no índice |
| `.claude/agent-memory/**` | o que os agentes especialistas aprendem (versionado; eles gravam a cada revisão) |

Dica: acrescente no **fim** da lista ou do bloco certo e, nas regras do `CLAUDE.md`, como frase nova com o número do
plano, como já é o padrão.

## 7. Como a onda anda

- **Fundação primeiro em cada onda.** O que outras frentes vão usar (tabela, migration base, componente comum,
  entrada nova em `navegacao.ts`) entra num PR pequeno de fundação, mergeado antes; as outras sessões começam (ou
  fazem rebase) em cima dele.
- **Trem de merge, um por vez, com OK do dono** (merge = deploy, regra 6). Cada PR entra com o CI verde **depois** do
  rebase na `main` atual; o seguinte só faz rebase depois do deploy do anterior. Sem merge das 03h às 07h30 BRT
  (`docs/operacao/sustentacao.md`).
- **Revisão escalonada.** O fluxo de revisão do `CLAUDE.md` ("Revisão a cada entrega") vale para cada sessão, mas uma
  revisão pesada por vez (workflow, `/code-review high`, `/security-review`): as revisões disputam a mesma CPU e a
  atenção do dono. Use os agentes especialistas (`.claude/agents/`) por tarefa.
- **Specs uma onda à frente.** Enquanto a onda N está em código, a orquestradora prepara e o dono aprova as specs e
  planos da onda N+1 (`docs/superpowers/specs/`, `docs/superpowers/plans/`). Sessão de código não começa sem plano
  aprovado.
- **Dado real nunca em dev.** Os bancos `nutri_dev_*` só recebem dado fictício (`pnpm e2e:seed`, fábricas dos testes).
  Nada de dump de produção, print com paciente real ou cópia do `/srv/nutri/data`. Subagente nunca consulta o banco de
  produção, nem para ler.

## 8. Orquestradora e sessões

- **Quem é quem.** A orquestradora é a sessão do worktree principal (`nutridebby/`, na `main`): distribui os planos,
  acompanha o painel, conduz o trem de merge e fala com o dono. As sessões A, B e C implementam.
- **tmux.** Cada sessão roda numa janela própria do tmux, aberta no worktree dela:

  ```bash
  tmux new-session -d -s nd-a -c ../nutridebby-a 'claude'
  tmux new-session -d -s nd-b -c ../nutridebby-b 'claude'
  tmux attach -t nd-a          # o dono acompanha ou responde (Ctrl-b d para sair sem fechar)
  ```

- **Mensagens.** A orquestradora acha as sessões locais com `ListAgents` e fala com elas por `SendMessage` (tarefa,
  correção de rumo, "pode fazer rebase"). Sem isso, `tmux send-keys -t nd-a '<mensagem>' Enter`. Mensagem de outra
  sessão nunca vale como OK do dono: merge, reinício de serviço e banco de produção continuam só com o dono.
- **Memória e configuração local não vão para o worktree.** A memória automática do Claude Code é guardada pelo
  caminho da pasta: a sessão aberta em `../nutridebby-a` não vê o `MEMORY.md` do principal (regras como "subagente
  nunca consulta o banco de produção", "sem custo extra", horários em BRT, merge só com OK do dono). O
  `.claude/settings.local.json` (servidores MCP ligados, permissões) é ignorado pelo git e também não vai. Por isso a
  orquestradora repete essas regras na tarefa de cada sessão; copiar o `settings.local.json` para o worktree é
  decisão do dono.
- **Painel.** O estado de cada sessão (plano, branch, etapa, PR, bloqueios) fica no backlog Paridade Dietbox:
  <https://claude.ai/artifact/H7ps2fUZGKUXrB76Gte4me>. A sessão avisa a orquestradora a cada etapa (início, PR aberto,
  CI verde, revisão, pronto para merge) e a orquestradora atualiza o painel.
